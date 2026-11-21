// Pieces of a routed call that need no router state: the provider call with
// its timeout, the final error code, and the log line.
import { BACKOFF_JITTER_RATIO, BACKOFF_STEPS_MS, CHARS_PER_TOKEN } from "@clauseclear/shared";
import type { Clock } from "./limiter.js";
import {
  BadOutputError,
  LlmError,
  TimeoutError,
  type GenerateJsonResult,
  type LlmProvider,
} from "./provider.js";
import {
  RATE_REASONS,
  type LlmLogEntry,
  type BlockReason,
  type Progress,
  type RouterErrorCode,
  type RouterRequest,
  type Slot,
} from "./routerTypes.js";

/** The provider call with a per-call timeout, capped by the deadline, and abort propagation. */
export async function callWithTimeout(
  provider: LlmProvider,
  request: RouterRequest,
  signal: AbortSignal | undefined,
  deadline: number,
  clock: Clock,
  timeoutLimitMs: number,
): Promise<GenerateJsonResult> {
  signal?.throwIfAborted();
  const timeoutMs = Math.min(timeoutLimitMs, deadline - clock.now());
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
  clock.sleep(timeoutMs, timer.signal).then(
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

/** The error code for a call every provider failed, from why each one stopped. */
export function routerErrorCode(progress: Map<Slot, Progress>): RouterErrorCode {
  // A provider skipped as too small for the request says nothing about the others.
  const states = [...progress.values()].filter((s) => s.last !== "too_large");
  if (states.length === 0) return "PROVIDER_UNAVAILABLE";
  if (states.every((s) => s.last !== undefined && RATE_REASONS.has(s.last))) return "RATE_LIMITED";
  const tried = states.filter((s) => s.attempts > 0);
  if (tried.length > 0 && tried.every((s) => s.last === "bad_output")) return "ANALYSIS_FAILED";
  return "PROVIDER_UNAVAILABLE";
}

/** The log line for one model call: counts and outcome, never text. */
export function callLogEntry(
  provider: LlmProvider,
  request: RouterRequest,
  repair: boolean,
  latencyMs: number,
  error: unknown,
  result?: GenerateJsonResult,
): LlmLogEntry {
  const inputChars = request.system.length + request.user.length;
  const outcome = error === undefined ? "ok" : error instanceof LlmError ? error.kind : "aborted";
  return {
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
    latencyMs,
    inputChars,
    estInputTokens: Math.ceil(inputChars / CHARS_PER_TOKEN),
    ...(result === undefined ? {} : { outputChars: result.text.length }),
    ...(result?.usage?.inputTokens === undefined ? {} : { inputTokens: result.usage.inputTokens }),
    ...(result?.usage?.outputTokens === undefined
      ? {}
      : { outputTokens: result.usage.outputTokens }),
    ...(result?.usage?.thinkingTokens === undefined
      ? {}
      : { thinkingTokens: result.usage.thinkingTokens }),
  };
}

/** Why a provider cannot take a call right now, and when it can, or undefined if it can. */
export function blockedFor(
  slot: Slot,
  state: Progress,
  now: number,
): { reason: BlockReason; at: number } | undefined {
  if (slot.daily.remaining() === 0) return { reason: "daily", at: now + slot.daily.msUntilReset() };
  const breakerWait = slot.breaker.waitMs();
  if (breakerWait > 0) return { reason: "breaker", at: now + breakerWait };
  if (state.nextAt > now) return { reason: "cooldown", at: state.nextAt };
  const rpmWait = slot.bucket.waitMs();
  if (rpmWait > 0) return { reason: "rpm", at: now + rpmWait };
  return undefined;
}

/** The wait before retry number step + 1: 2, 4 or 8 s with jitter. */
export function backoffMs(step: number, random: () => number): number {
  const base = BACKOFF_STEPS_MS[Math.min(step, BACKOFF_STEPS_MS.length - 1)] ?? 0;
  const jitter = (random() * 2 - 1) * BACKOFF_JITTER_RATIO;
  return Math.round(base * (1 + jitter));
}
