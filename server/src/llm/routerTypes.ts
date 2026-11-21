// The router's public types, its error, and the per-call bookkeeping it keeps
// for each provider.
import type { ErrorCode } from "@clauseclear/shared";
import type { CircuitBreaker, Clock, DailyCounter, TokenBucket } from "./limiter.js";
import type { GenerateJsonRequest, LlmErrorKind, LlmProvider, LlmUsage } from "./provider.js";

export type RouterRequest = Omit<GenerateJsonRequest, "signal">;

export interface RoutedProvider {
  provider: LlmProvider;
  rpm: number;
  rpdBudget: number;
  /** Largest maxOutputTokens this provider is asked for; bigger requests skip it. */
  maxOutputTokens?: number;
}

/** One line per model call or exhaustion. Never text, quotes, prompts or keys. */
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

export type RouterErrorCode = Extract<
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

export interface Slot {
  provider: LlmProvider;
  maxOutputTokens: number | undefined;
  bucket: TokenBucket;
  daily: DailyCounter;
  breaker: CircuitBreaker;
}

export type BlockReason = "daily" | "rpm" | "breaker" | "cooldown" | "too_large";

/** Per-call progress for one provider. */
export interface Progress {
  attempts: number;
  nextAt: number;
  done: boolean;
  /** Why this provider could not serve the call, for the final error and log. */
  last?: LlmErrorKind | BlockReason;
  availableAt?: number;
}

export const RATE_REASONS = new Set<string>(["rate_limit", "daily", "rpm"]);

/** What one pass over a provider produced: a result, or when it may be tried again. */
export interface Pass<T> {
  result?: RouterResult<T>;
  retryAt?: number;
}
