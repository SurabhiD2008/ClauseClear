// The LLM router (SPEC section 5 rules 2 to 5, 9). Providers are tried in
// LLM_PROVIDER_ORDER. Rate limits, transient errors, timeouts and unusable
// output move to the next provider; a provider that failed is tried again only
// after its Retry-After or its backoff step (2 s, 4 s, 8 s with jitter), at most
// three times per call. Auth and request errors also move to the next provider
// but are never retried on the same one: retrying cannot fix a bad key or model
// ID. They count toward the breaker, so a broken key is skipped after three
// calls and re-checked once a minute (ASSUMPTIONS A53).
//
// Everything is bounded: the analysis deadline (ANALYSIS_BUDGET_MS), a per-call
// timeout (LLM_TIMEOUT_MS), a token bucket and daily budget per provider, a
// circuit breaker per provider, and a global queue (LLM_CONCURRENCY).
import {
  BACKOFF_JITTER_RATIO,
  BACKOFF_STEPS_MS,
  CHARS_PER_TOKEN,
  type ErrorCode,
} from "@clauseclear/shared";
import { repairRequest, type OutputSpec } from "./json.js";
import {
  CircuitBreaker,
  ConcurrencyQueue,
  DailyCounter,
  TokenBucket,
  systemClock,
  type Clock,
} from "./limiter.js";
import {
  BadOutputError,
  LlmError,
  RateLimitError,
  TimeoutError,
  type GenerateJsonRequest,
  type GenerateJsonResult,
  type LlmErrorKind,
  type LlmProvider,
  type LlmUsage,
} from "./provider.js";

export type RouterRequest = Omit<GenerateJsonRequest, "signal">;

export interface RoutedProvider {
  provider: LlmProvider;
  rpm: number;
  rpdBudget: number;
  /** Largest maxOutputTokens this provider is asked for; bigger requests skip it (A95). */
  maxOutputTokens?: number;
}

/** One line per model call or exhaustion. Never text, quotes, prompts or keys (A6). */
export type LlmLogEntry =
  | {
      event: "llm_call";
      provider: string;
      model: string;
      schemaName: string;
      repair: boolean;
      outcome: "ok" | LlmErrorKind | "aborted";
      reason?: string;
      httpStatus?: number;
      latencyMs: number;
      inputChars: number;
      estInputTokens: number;
      outputChars?: number;
      inputTokens?: number;
      outputTokens?: number;
      thinkingTokens?: number;
    }
  | {
      event: "llm_exhausted";
      schemaName: string;
      code: RouterErrorCode;
      providers: { provider: string; reason: string }[];
    };

export interface RouterOptions {
  providers: RoutedProvider[];
  concurrency: number;
  timeoutMs: number;
  budgetMs: number;
  clock?: Clock;
  /** Returns [0, 1). Injected so jitter is deterministic in tests. */
  random?: () => number;
  log?: (entry: LlmLogEntry) => void;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Absolute time (clock ms) the whole analysis must finish by. Defaults to now + budgetMs. */
  deadline?: number;
}

export interface RouterResult<T> {
  value: T;
  provider: string;
  model: string;
  usage?: LlmUsage;
}

type RouterErrorCode = Extract<
  ErrorCode,
  "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "ANALYSIS_FAILED"
>;

/** The router's only failure besides an abort. code is a shared ErrorCode for the API. */
export class LlmRouterError extends Error {
  override readonly name = "LlmRouterError";

  constructor(
    readonly code: RouterErrorCode,
    readonly retryAfterSec?: number,
  ) {
    super(
      code === "RATE_LIMITED"
        ? "every provider is rate limited or out of daily budget"
        : code === "ANALYSIS_FAILED"
          ? "every provider returned unusable output"
          : "no provider could answer",
    );
  }
}

interface Slot {
  provider: LlmProvider;
  maxOutputTokens: number | undefined;
  bucket: TokenBucket;
  daily: DailyCounter;
  breaker: CircuitBreaker;
}

type BlockReason = "daily" | "rpm" | "breaker" | "cooldown" | "too_large";

/** Per-call progress for one provider. */
interface Progress {
  attempts: number;
  nextAt: number;
  done: boolean;
  /** Why this provider could not serve the call, for the final error and log. */
  last?: LlmErrorKind | BlockReason;
  availableAt?: number;
}

const RATE_REASONS = new Set<string>(["rate_limit", "daily", "rpm"]);

export class LlmRouter {
  private readonly slots: Slot[];
  private readonly queue: ConcurrencyQueue;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly log: (entry: LlmLogEntry) => void;

  constructor(private readonly options: RouterOptions) {
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? (() => undefined);
    this.queue = new ConcurrencyQueue(options.concurrency);
    this.slots = options.providers.map(({ provider, rpm, rpdBudget, maxOutputTokens }) => ({
      provider,
      maxOutputTokens,
      bucket: new TokenBucket(rpm, this.clock),
      daily: new DailyCounter(rpdBudget, this.clock),
      breaker: new CircuitBreaker(this.clock),
    }));
  }

  /** The smallest per-provider output cap, when any provider has one (A95). */
  get smallestOutputCap(): number | undefined {
    const caps = this.slots
      .map((s) => s.maxOutputTokens)
      .filter((c): c is number => c !== undefined);
    return caps.length === 0 ? undefined : Math.min(...caps);
  }

  get providerNames(): string[] {
    return this.slots.map((slot) => slot.provider.name);
  }

  /** Breaker state per provider, for diagnostics and tests. */
  breakerStates(): Record<string, string> {
    return Object.fromEntries(this.slots.map((s) => [s.provider.name, s.breaker.state()]));
  }

  async generate<T>(
    request: RouterRequest,
    output: OutputSpec<T>,
    options: CallOptions = {},
  ): Promise<RouterResult<T>> {
    const { signal } = options;
    const deadline = options.deadline ?? this.clock.now() + this.options.budgetMs;
    // A provider capped below this request's output size is never called for it.
    const progress = new Map<Slot, Progress>(
      this.slots.map((slot) => [
        slot,
        slot.maxOutputTokens !== undefined && slot.maxOutputTokens < request.maxOutputTokens
          ? { attempts: 0, nextAt: 0, done: true, last: "too_large" }
          : { attempts: 0, nextAt: 0, done: false },
      ]),
    );

    for (;;) {
      signal?.throwIfAborted();
      let soonest = Number.POSITIVE_INFINITY;

      for (const slot of this.slots) {
        const state = progress.get(slot);
        if (state === undefined || state.done) continue;
        // A spent budget ends the call here: no request, no rate or quota token (A93).
        if (deadline - this.clock.now() <= 0) {
          this.exhausted(request.schemaName, this.codeFor(progress), progress);
        }

        const blocked = this.blockedFor(slot, state);
        if (blocked !== undefined) {
          // A cooldown keeps the failure that caused it (rate_limit, timeout...).
          if (blocked.reason !== "cooldown") state.last = blocked.reason;
          state.availableAt = blocked.at;
          // An open breaker is the provider paused (SPEC section 5 rule 5): skip it
          // for this call rather than wait. Waiting held a user for 66 s before
          // PROVIDER_UNAVAILABLE when the only provider kept failing (A177).
          if (blocked.reason === "daily" || blocked.reason === "breaker") state.done = true;
          else soonest = Math.min(soonest, blocked.at);
          continue;
        }

        slot.bucket.tryTake();
        slot.daily.tryConsume();
        try {
          return await this.attempt(slot, request, output, signal, deadline);
        } catch (error) {
          if (signal?.aborted === true) throw signal.reason;
          if (!(error instanceof LlmError)) throw error;
          state.attempts += 1;
          state.last = error.kind;
          const wait =
            error instanceof RateLimitError && error.retryAfterMs !== undefined
              ? error.retryAfterMs
              : this.backoff(state.attempts - 1);
          // Kept even when the provider is done, so RATE_LIMITED can say when to retry.
          state.availableAt = this.clock.now() + wait;
          const final =
            error.kind === "bad_output" || error.kind === "auth" || error.kind === "request";
          // A failure that just opened the breaker ends this provider for the call (A177).
          if (final || state.attempts > BACKOFF_STEPS_MS.length || slot.breaker.waitMs() > 0) {
            state.done = true;
            continue;
          }
          state.nextAt = state.availableAt;
          soonest = Math.min(soonest, state.nextAt);
        }
      }

      // Nothing succeeded on this pass. Wait for the first provider to be free
      // again, unless none will be before the deadline.
      if (!Number.isFinite(soonest) || soonest > deadline) {
        this.exhausted(request.schemaName, this.codeFor(progress), progress);
      }
      await this.clock.sleep(soonest - this.clock.now(), signal);
    }
  }

  private blockedFor(slot: Slot, state: Progress): { reason: BlockReason; at: number } | undefined {
    const now = this.clock.now();
    if (slot.daily.remaining() === 0)
      return { reason: "daily", at: now + slot.daily.msUntilReset() };
    const breakerWait = slot.breaker.waitMs();
    if (breakerWait > 0) return { reason: "breaker", at: now + breakerWait };
    if (state.nextAt > now) return { reason: "cooldown", at: state.nextAt };
    const rpmWait = slot.bucket.waitMs();
    if (rpmWait > 0) return { reason: "rpm", at: now + rpmWait };
    return undefined;
  }

  private backoff(step: number): number {
    const base = BACKOFF_STEPS_MS[Math.min(step, BACKOFF_STEPS_MS.length - 1)] ?? 0;
    const jitter = (this.random() * 2 - 1) * BACKOFF_JITTER_RATIO;
    return Math.round(base * (1 + jitter));
  }

  /** One provider: a queued call, then parse; one repair call on a schema failure. */
  private async attempt<T>(
    slot: Slot,
    request: RouterRequest,
    output: OutputSpec<T>,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<RouterResult<T>> {
    return this.queue.run(async () => {
      slot.breaker.begin();
      let current = request;
      let repairsLeft = output.repairRetries;
      try {
        for (;;) {
          const repair = current !== request;
          const started = this.clock.now();
          let result: GenerateJsonResult;
          try {
            result = await this.call(slot.provider, current, signal, deadline);
          } catch (error) {
            this.logCall(slot.provider, current, repair, started, error);
            throw error;
          }
          try {
            const value = output.parse(slot.provider.name, result.text);
            this.logCall(slot.provider, current, repair, started, undefined, result);
            slot.breaker.success();
            return {
              value,
              provider: slot.provider.name,
              model: slot.provider.model,
              ...(result.usage === undefined ? {} : { usage: result.usage }),
            };
          } catch (error) {
            this.logCall(slot.provider, current, repair, started, error, result);
            const canRepair =
              error instanceof BadOutputError &&
              error.repairHint !== undefined &&
              repairsLeft > 0 &&
              slot.daily.remaining() > 0 &&
              slot.bucket.waitMs() === 0;
            if (!canRepair) throw error;
            repairsLeft -= 1;
            slot.bucket.tryTake();
            slot.daily.tryConsume();
            current = repairRequest(request, error.repairHint);
          }
        }
      } catch (error) {
        // A 429 is the provider asking us to slow down, not a fault: Retry-After
        // and backoff handle it, so it neither opens nor resets the breaker (A54).
        if (signal?.aborted === true || error instanceof RateLimitError) slot.breaker.cancel();
        else slot.breaker.failure();
        throw error;
      }
    }, signal);
  }

  /** The provider call with a per-call timeout, capped by the deadline, and abort propagation. */
  private async call(
    provider: LlmProvider,
    request: RouterRequest,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<GenerateJsonResult> {
    signal?.throwIfAborted();
    const timeoutMs = Math.min(this.options.timeoutMs, deadline - this.clock.now());
    if (timeoutMs <= 0) throw new TimeoutError(provider.name, 0);

    const timeout = new AbortController();
    const timer = new AbortController();
    const combined =
      signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal]);
    // Racing on the combined signal returns even if a provider ignores it.
    const aborted = new Promise<never>((_resolve, reject) => {
      const fail = () => {
        reject(combined.reason as Error);
      };
      if (combined.aborted) fail();
      else combined.addEventListener("abort", fail, { once: true });
    });
    aborted.catch(() => undefined);
    this.clock.sleep(timeoutMs, timer.signal).then(
      () => {
        timeout.abort(new TimeoutError(provider.name, timeoutMs));
      },
      () => undefined,
    );

    try {
      return await Promise.race([provider.generateJson({ ...request, signal: combined }), aborted]);
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason;
      if (timeout.signal.aborted) throw timeout.signal.reason;
      throw error;
    } finally {
      timer.abort();
    }
  }

  private codeFor(progress: Map<Slot, Progress>): RouterErrorCode {
    // A provider skipped as too small for the request says nothing about the others.
    const states = [...progress.values()].filter((s) => s.last !== "too_large");
    if (states.length === 0) return "PROVIDER_UNAVAILABLE";
    if (states.every((s) => s.last !== undefined && RATE_REASONS.has(s.last)))
      return "RATE_LIMITED";
    const tried = states.filter((s) => s.attempts > 0);
    if (tried.length > 0 && tried.every((s) => s.last === "bad_output")) return "ANALYSIS_FAILED";
    return "PROVIDER_UNAVAILABLE";
  }

  private exhausted(
    schemaName: string,
    code: RouterErrorCode,
    progress: Map<Slot, Progress>,
  ): never {
    const now = this.clock.now();
    const waits = [...progress.values()]
      .map((s) => s.availableAt)
      .filter((at): at is number => at !== undefined && at > now)
      .map((at) => at - now);
    const retryAfterSec =
      code === "RATE_LIMITED" && waits.length > 0
        ? Math.max(1, Math.ceil(Math.min(...waits) / 1000))
        : undefined;
    this.log({
      event: "llm_exhausted",
      schemaName,
      code,
      providers: [...progress.entries()].map(([slot, state]) => ({
        provider: slot.provider.name,
        reason: state.last ?? "not_tried",
      })),
    });
    throw new LlmRouterError(code, retryAfterSec);
  }

  private logCall(
    provider: LlmProvider,
    request: RouterRequest,
    repair: boolean,
    started: number,
    error: unknown,
    result?: GenerateJsonResult,
  ): void {
    const inputChars = request.system.length + request.user.length;
    const outcome = error === undefined ? "ok" : error instanceof LlmError ? error.kind : "aborted";
    this.log({
      event: "llm_call",
      provider: provider.name,
      model: provider.model,
      schemaName: request.schemaName,
      repair,
      outcome,
      ...(error instanceof BadOutputError ? { reason: error.reason } : {}),
      ...(error instanceof LlmError && error.httpStatus !== undefined
        ? { httpStatus: error.httpStatus }
        : {}),
      latencyMs: this.clock.now() - started,
      inputChars,
      estInputTokens: Math.ceil(inputChars / CHARS_PER_TOKEN),
      ...(result === undefined ? {} : { outputChars: result.text.length }),
      ...(result?.usage?.inputTokens === undefined
        ? {}
        : { inputTokens: result.usage.inputTokens }),
      ...(result?.usage?.outputTokens === undefined
        ? {}
        : { outputTokens: result.usage.outputTokens }),
      ...(result?.usage?.thinkingTokens === undefined
        ? {}
        : { thinkingTokens: result.usage.thinkingTokens }),
    });
  }
}
