// One interface for every model provider (SPEC section 5), so adding a free
// endpoint is a new env block, not new code. Errors are typed so the router can
// decide between retry, fallback and failure without reading message text.
//
// Error messages carry the provider name and HTTP status only: never a key, a
// URL, a response body or any prompt or document text.

export interface GenerateJsonRequest {
  system: string;
  user: string;
  /** Names the expected output (for example "analysis"); used by the mock and in logs. */
  schemaName: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Reasoning tokens, when the provider reports them separately (Gemini thoughtsTokenCount). */
  thinkingTokens?: number;
}

export interface GenerateJsonResult {
  /** Raw model text. Parsing and validation happen in the router (json.ts). */
  text: string;
  usage?: LlmUsage;
}

/** Builds a result, leaving out usage fields the provider did not report. */
export function resultWithUsage(
  text: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  thinkingTokens?: number,
): GenerateJsonResult {
  if (inputTokens === undefined && outputTokens === undefined && thinkingTokens === undefined)
    return { text };
  return {
    text,
    usage: {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(thinkingTokens === undefined ? {} : { thinkingTokens }),
    },
  };
}

export interface LlmProvider {
  /** Name from LLM_PROVIDER_ORDER, for example "gemini" or "nvidia". */
  readonly name: string;
  /** Model ID from env. Logged; never hard-coded. */
  readonly model: string;
  generateJson(request: GenerateJsonRequest): Promise<GenerateJsonResult>;
}

/** Response metadata for diagnostics (check:providers prints rate-limit headers). */
export interface ResponseMeta {
  status: number;
  headers: Headers;
}

export type LlmErrorKind =
  "rate_limit" | "transient" | "timeout" | "auth" | "request" | "bad_output";

export abstract class LlmError extends Error {
  abstract readonly kind: LlmErrorKind;
  readonly provider: string;
  readonly httpStatus: number | undefined;

  constructor(provider: string, message: string, httpStatus?: number) {
    super(`${provider}: ${message}`);
    this.provider = provider;
    this.httpStatus = httpStatus;
  }
}

/** HTTP 429. retryAfterMs comes from Retry-After when the provider sends it. */
export class RateLimitError extends LlmError {
  override readonly name = "RateLimitError";
  readonly kind = "rate_limit";
  readonly retryAfterMs: number | undefined;

  constructor(provider: string, retryAfterMs?: number, httpStatus = 429) {
    super(provider, `rate limited (HTTP ${String(httpStatus)})`, httpStatus);
    this.retryAfterMs = retryAfterMs;
  }
}

/** 5xx, 408, NVIDIA's 202 "pending", or a network failure: worth trying again or elsewhere. */
export class TransientError extends LlmError {
  override readonly name = "TransientError";
  readonly kind = "transient";
}

/** The per-call timeout (LLM_TIMEOUT_MS, capped by the analysis budget) fired. */
export class TimeoutError extends LlmError {
  override readonly name = "TimeoutError";
  readonly kind = "timeout";

  constructor(provider: string, timeoutMs: number) {
    super(provider, `no response within ${String(timeoutMs)} ms`);
  }
}

/** HTTP 401 or 403: the key is missing, wrong or not allowed to call this model. */
export class AuthError extends LlmError {
  override readonly name = "AuthError";
  readonly kind = "auth";

  constructor(provider: string, httpStatus: number) {
    super(provider, `authorization failed (HTTP ${String(httpStatus)})`, httpStatus);
  }
}

/** Any other 4xx: the provider rejected the request itself (bad model ID, bad field). */
export class RequestError extends LlmError {
  override readonly name = "RequestError";
  readonly kind = "request";

  constructor(provider: string, httpStatus: number) {
    super(provider, `request rejected (HTTP ${String(httpStatus)})`, httpStatus);
  }
}

/**
 * The provider answered, but the answer is unusable: empty, blocked, truncated,
 * not JSON, or JSON that fails the schema. repairHint is set only for the last
 * case; it lists schema issues (paths and rule messages, never values).
 */
export class BadOutputError extends LlmError {
  override readonly name = "BadOutputError";
  readonly kind = "bad_output";
  readonly reason: "empty" | "blocked" | "truncated" | "malformed" | "schema" | "body";
  readonly repairHint: string | undefined;

  constructor(provider: string, reason: BadOutputError["reason"], repairHint?: string) {
    super(provider, `unusable output (${reason})`);
    this.reason = reason;
    this.repairHint = repairHint;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
