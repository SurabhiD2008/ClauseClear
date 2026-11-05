// The one place provider adapters touch the network. It maps HTTP outcomes to
// the typed errors in provider.ts and never puts a URL, header or body into an
// error message, because those can hold keys or document text.
import {
  AuthError,
  BadOutputError,
  RateLimitError,
  RequestError,
  TransientError,
  type ResponseMeta,
} from "./provider.js";

export type FetchLike = typeof fetch;

export interface RequestJsonOptions {
  provider: string;
  fetch: FetchLike;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  method?: "GET" | "POST";
  signal?: AbortSignal | undefined;
  onResponse?: ((meta: ResponseMeta) => void) | undefined;
}

/** Retry-After as delta-seconds or an HTTP date (RFC 9110 section 10.2.3). */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/** Sends a JSON request and returns the parsed JSON body of a 200 response. */
export async function requestJson(options: RequestJsonOptions): Promise<unknown> {
  const { provider, signal } = options;
  const hasBody = options.body !== undefined;
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(hasBody ? { "content-type": "application/json" } : {}),
    ...options.headers,
  };
  let response: Response;
  try {
    response = await options.fetch(options.url, {
      method: options.method ?? (hasBody ? "POST" : "GET"),
      headers,
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    // An aborted signal (caller cancel or router timeout) keeps its own reason.
    if (signal?.aborted === true) throw signal.reason;
    // Anything else is a network failure. The cause is not attached: undici
    // errors can include the request URL.
    throw new TransientError(provider, "network error");
  }

  options.onResponse?.({ status: response.status, headers: response.headers });
  const { status } = response;

  if (status !== 200) {
    // Drain the body so the connection is released, but never read it into an error.
    await response.body?.cancel().catch(() => undefined);
    if (status === 429) {
      throw new RateLimitError(
        provider,
        parseRetryAfter(response.headers.get("retry-after"), Date.now()),
      );
    }
    if (status === 401 || status === 403) throw new AuthError(provider, status);
    if (status === 408 || status >= 500)
      throw new TransientError(provider, `HTTP ${String(status)}`, status);
    // NVIDIA answers 202 when a result is still pending; polling is not supported,
    // so it counts as a transient failure.
    if (status === 202) throw new TransientError(provider, "result pending (HTTP 202)", status);
    throw new RequestError(provider, status);
  }

  try {
    return await response.json();
  } catch {
    if (signal?.aborted === true) throw signal.reason;
    throw new BadOutputError(provider, "body");
  }
}

/** Narrowing helpers for untyped provider JSON. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
