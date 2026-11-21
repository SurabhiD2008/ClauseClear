// The LLM router. Providers are tried in
// LLM_PROVIDER_ORDER. Rate limits, transient errors, timeouts and unusable
// output move to the next provider; a provider that failed is tried again only
// after its Retry-After or its backoff step (2 s, 4 s, 8 s with jitter), at most
// three times per call. Auth and request errors also move to the next provider
// but are never retried on the same one: retrying cannot fix a bad key or model
// ID. They count toward the breaker, so a broken key is skipped after three
// calls and re-checked once a minute.
//
// Everything is bounded: the analysis deadline (ANALYSIS_BUDGET_MS), a per-call
// timeout (LLM_TIMEOUT_MS), a token bucket and daily budget per provider, a
// circuit breaker per provider, and a global queue (LLM_CONCURRENCY).
import { BACKOFF_STEPS_MS } from "@clauseclear/shared";
import { repairRequest, type OutputSpec } from "./json.js";
import {
  CircuitBreaker,
  ConcurrencyQueue,
  DailyCounter,
  TokenBucket,
  systemClock,
  type Clock,
} from "./limiter.js";
import { BadOutputError, LlmError, RateLimitError } from "./provider.js";
import {
  backoffMs,
  blockedFor,
  callLogEntry,
  callWithTimeout,
  routerErrorCode,
} from "./routerCall.js";
import {
  LlmRouterError,
  type CallOptions,
  type LlmLogEntry,
  type Pass,
  type Progress,
  type RouterErrorCode,
  type RouterOptions,
  type RouterRequest,
  type RouterResult,
  type Slot,
} from "./routerTypes.js";

export {
  LlmRouterError,
  type CallOptions,
  type LlmLogEntry,
  type RoutedProvider,
  type RouterOptions,
  type RouterRequest,
  type RouterResult,
} from "./routerTypes.js";

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

  /** The smallest per-provider output cap, when any provider has one. */
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
    const progress = this.startProgress(request);

    for (;;) {
      signal?.throwIfAborted();
      let soonest = Number.POSITIVE_INFINITY;
      for (const slot of this.slots) {
        const state = progress.get(slot);
        if (state === undefined || state.done) continue;
        // A spent budget ends the call here: no request, no rate or quota token.
        if (deadline - this.clock.now() <= 0) {
          this.exhausted(request.schemaName, routerErrorCode(progress), progress);
        }
        const pass = await this.tryProvider(slot, state, request, output, signal, deadline);
        if (pass.result !== undefined) return pass.result;
        if (pass.retryAt !== undefined) soonest = Math.min(soonest, pass.retryAt);
      }
      // Nothing succeeded on this pass. Wait for the first provider to be free
      // again, unless none will be before the deadline.
      if (!Number.isFinite(soonest) || soonest > deadline) {
        this.exhausted(request.schemaName, routerErrorCode(progress), progress);
      }
      await this.clock.sleep(soonest - this.clock.now(), signal);
    }
  }

  /** A provider capped below this request's output size is never called for it. */
  private startProgress(request: RouterRequest): Map<Slot, Progress> {
    return new Map<Slot, Progress>(
      this.slots.map((slot) => [
        slot,
        slot.maxOutputTokens !== undefined && slot.maxOutputTokens < request.maxOutputTokens
          ? { attempts: 0, nextAt: 0, done: true, last: "too_large" }
          : { attempts: 0, nextAt: 0, done: false },
      ]),
    );
  }

  /** One pass over one provider: skip it if blocked, otherwise call it once. */
  private async tryProvider<T>(
    slot: Slot,
    state: Progress,
    request: RouterRequest,
    output: OutputSpec<T>,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<Pass<T>> {
    const blocked = blockedFor(slot, state, this.clock.now());
    if (blocked !== undefined) {
      // A cooldown keeps the failure that caused it (rate_limit, timeout...).
      if (blocked.reason !== "cooldown") state.last = blocked.reason;
      state.availableAt = blocked.at;
      // An open breaker is the provider paused: skip it for this call rather
      // than wait. Waiting held a user for 66 s before PROVIDER_UNAVAILABLE when
      // the only provider kept failing.
      if (blocked.reason === "daily" || blocked.reason === "breaker") {
        state.done = true;
        return {};
      }
      return { retryAt: blocked.at };
    }
    slot.bucket.tryTake();
    slot.daily.tryConsume();
    try {
      return { result: await this.attempt(slot, request, output, signal, deadline) };
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason;
      if (!(error instanceof LlmError)) throw error;
      return this.recordFailure(slot, state, error);
    }
  }

  /** Notes a failed attempt and decides whether and when this provider is tried again. */
  private recordFailure(slot: Slot, state: Progress, error: LlmError): Pass<never> {
    state.attempts += 1;
    state.last = error.kind;
    const wait =
      error instanceof RateLimitError && error.retryAfterMs !== undefined
        ? error.retryAfterMs
        : backoffMs(state.attempts - 1, this.random);
    // Kept even when the provider is done, so RATE_LIMITED can say when to retry.
    state.availableAt = this.clock.now() + wait;
    const final = error.kind === "bad_output" || error.kind === "auth" || error.kind === "request";
    // A failure that just opened the breaker ends this provider for the call.
    if (final || state.attempts > BACKOFF_STEPS_MS.length || slot.breaker.waitMs() > 0) {
      state.done = true;
      return {};
    }
    state.nextAt = state.availableAt;
    return { retryAt: state.nextAt };
  }

  /** One provider: a queued call, then parse; the breaker learns the outcome. */
  private async attempt<T>(
    slot: Slot,
    request: RouterRequest,
    output: OutputSpec<T>,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<RouterResult<T>> {
    return this.queue.run(async () => {
      slot.breaker.begin();
      try {
        const result = await this.callAndParse(slot, request, output, signal, deadline);
        slot.breaker.success();
        return result;
      } catch (error) {
        // A 429 is the provider asking us to slow down, not a fault: Retry-After
        // and backoff handle it, so it neither opens nor resets the breaker.
        if (signal?.aborted === true || error instanceof RateLimitError) slot.breaker.cancel();
        else slot.breaker.failure();
        throw error;
      }
    }, signal);
  }

  /** Calls and parses; a schema failure gets one repair call while the budgets allow. */
  private async callAndParse<T>(
    slot: Slot,
    request: RouterRequest,
    output: OutputSpec<T>,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<RouterResult<T>> {
    let current = request;
    let repairsLeft = output.repairRetries;
    for (;;) {
      const repair = current !== request;
      const started = this.clock.now();
      const logCall = (error: unknown, result?: Parameters<typeof callLogEntry>[5]) => {
        this.log(
          callLogEntry(slot.provider, current, repair, this.clock.now() - started, error, result),
        );
      };
      let result;
      try {
        result = await callWithTimeout(
          slot.provider,
          current,
          signal,
          deadline,
          this.clock,
          this.options.timeoutMs,
        );
      } catch (error) {
        logCall(error);
        throw error;
      }
      try {
        const value = output.parse(slot.provider.name, result.text);
        logCall(undefined, result);
        return {
          value,
          provider: slot.provider.name,
          model: slot.provider.model,
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        };
      } catch (error) {
        logCall(error, result);
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
}
