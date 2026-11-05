// The client side of the API contract (SPEC section 7). Every response is parsed
// with the shared zod schemas; any failure becomes an ApiError carrying the one
// error body shape, so the UI has a single kind of error to show.
import {
  ERROR_DEFINITIONS,
  errorBody,
  errorEventSchema,
  sampleResponseSchema,
  samplesListResponseSchema,
  translateResponseSchema,
  type DocType,
  type ErrorBody,
  type ErrorCode,
  type ErrorEvent,
  type SampleResponse,
  type SampleSummary,
  type TranslateResponse,
  type TranslationMap,
} from "@clauseclear/shared";
import { createSseParser, decodeAnalyzeEvent, type AnalyzeEvent } from "./sse";

export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(readonly body: ErrorBody) {
    super(body.message);
  }
  get code(): ErrorCode {
    return this.body.code;
  }
}

export type AnalyzeInput =
  | { kind: "text"; text: string; docType?: DocType }
  | { kind: "file"; file: Blob; name?: string; docType?: DocType };

export interface StreamOptions {
  signal: AbortSignal;
  onEvent: (event: AnalyzeEvent) => void;
}

export interface Api {
  /** Resolves when the stream ends. Events reach onEvent in order; an off-contract event rejects. */
  streamAnalysis: (input: AnalyzeInput, options: StreamOptions) => Promise<void>;
  listSamples: (signal?: AbortSignal) => Promise<SampleSummary[]>;
  getSample: (id: string, signal?: AbortSignal) => Promise<SampleResponse>;
  translate: (strings: TranslationMap, signal?: AbortSignal) => Promise<TranslateResponse>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** zod's optional field allows an explicit undefined; ErrorBody does not. */
export function fromErrorEvent(event: ErrorEvent): ErrorBody {
  const body: ErrorBody = { code: event.code, message: event.message };
  if (event.retryAfterSec !== undefined) body.retryAfterSec = event.retryAfterSec;
  return body;
}

/** The server's error body when it sent one, otherwise a generic one for the status. */
async function errorFrom(response: Response): Promise<ApiError> {
  try {
    const parsed = errorEventSchema.safeParse(await response.json());
    if (parsed.success) return new ApiError(fromErrorEvent(parsed.data));
  } catch {
    // Not JSON (a proxy page, an empty body): fall through to the status.
  }
  const byStatus = (Object.keys(ERROR_DEFINITIONS) as ErrorCode[]).find(
    (code) => ERROR_DEFINITIONS[code].status === response.status,
  );
  return new ApiError(errorBody(byStatus ?? "ANALYSIS_FAILED"));
}

async function json<T>(
  response: Response,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
): Promise<T> {
  if (!response.ok) throw await errorFrom(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(errorBody("ANALYSIS_FAILED"));
  return parsed.data;
}

export function createApi(fetchImpl: Fetch = (input, init) => fetch(input, init)): Api {
  return {
    streamAnalysis: async (input, { signal, onEvent }) => {
      let init: RequestInit;
      if (input.kind === "text") {
        init = {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(
            input.docType === undefined
              ? { text: input.text }
              : { text: input.text, docType: input.docType },
          ),
        };
      } else {
        const form = new FormData();
        // docType goes first: the server reads at most one field and one file.
        if (input.docType !== undefined) form.append("docType", input.docType);
        form.append("file", input.file, input.name ?? "document.pdf");
        init = { method: "POST", headers: { Accept: "text/event-stream" }, body: form };
      }

      const response = await fetchImpl("/api/analyze", { ...init, signal });
      if (!response.ok) throw await errorFrom(response);
      const type = response.headers.get("Content-Type") ?? "";
      if (!type.startsWith("text/event-stream") || response.body === null) {
        throw new ApiError(errorBody("ANALYSIS_FAILED"));
      }

      // A holder, not a let: the parser callback sets it, which narrowing cannot see.
      const stream: { failure: ApiError | null } = { failure: null };
      const parser = createSseParser((raw) => {
        if (stream.failure !== null) return;
        const decoded = decodeAnalyzeEvent(raw);
        if (decoded.type === "unknown") return;
        if (decoded.type === "invalid") {
          stream.failure = new ApiError(errorBody("ANALYSIS_FAILED"));
          return;
        }
        onEvent(decoded);
      });

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(value);
          if (stream.failure !== null) break;
        }
      } finally {
        parser.end();
      }
      if (stream.failure !== null) {
        // Stop reading an off-contract stream; the server sees a disconnect and aborts.
        await reader.cancel().catch(() => undefined);
        throw stream.failure;
      }
    },

    listSamples: async (signal) =>
      json(await fetchImpl("/api/samples", { signal: signal ?? null }), samplesListResponseSchema),

    getSample: async (id, signal) =>
      json(
        await fetchImpl(`/api/samples/${encodeURIComponent(id)}`, { signal: signal ?? null }),
        sampleResponseSchema,
      ),

    translate: async (strings, signal) =>
      json(
        await fetchImpl("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang: "hi", strings }),
          signal: signal ?? null,
        }),
        translateResponseSchema,
      ),
  };
}
