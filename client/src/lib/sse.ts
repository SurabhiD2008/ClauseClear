// Server-sent events from POST /api/analyze (SPEC section 7). The browser's
// EventSource cannot POST, so the response body is read as a stream and parsed
// here: an incremental parser for the wire format (WHATWG "event stream
// interpretation"), then a typed decoder for the three events the API sends.
import {
  SSE_EVENTS,
  errorEventSchema,
  resultEventSchema,
  statusEventSchema,
  type AnalysisResult,
  type ErrorEvent,
  type StatusEvent,
} from "@clauseclear/shared";

export interface RawSseEvent {
  event: string;
  data: string;
}

export interface SseParser {
  /** Feeds the next decoded chunk; it may end anywhere, even inside a line. */
  push: (chunk: string) => void;
  /** End of stream. An event without its closing blank line is discarded, as the standard says. */
  end: () => void;
}

export function createSseParser(onEvent: (event: RawSseEvent) => void): SseParser {
  let buffer = "";
  let eventName = "";
  let data: string[] = [];
  // A chunk that ends in "\r" may be the first half of "\r\n".
  let skipLeadingLf = false;

  const dispatch = () => {
    if (data.length > 0)
      onEvent({ event: eventName === "" ? "message" : eventName, data: data.join("\n") });
    eventName = "";
    data = [];
  };

  const line = (text: string) => {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) return; // comment, e.g. the server's keep-alive
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") data.push(value);
    // id and retry are not used by this API; unknown fields are ignored.
  };

  return {
    push: (chunk) => {
      buffer += chunk;
      if (skipLeadingLf && buffer.startsWith("\n")) buffer = buffer.slice(1);
      skipLeadingLf = false;
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (match === null) return;
        if (match[0] === "\r" && match.index === buffer.length - 1) {
          skipLeadingLf = true;
        }
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    end: () => {
      buffer = "";
      eventName = "";
      data = [];
    },
  };
}

export type AnalyzeEvent =
  | { type: "status"; data: StatusEvent }
  | { type: "result"; data: AnalysisResult }
  | { type: "error"; data: ErrorEvent };

export type DecodedEvent =
  | AnalyzeEvent
  /** An event name this client does not know; ignored. */
  | { type: "unknown"; name: string }
  /** A known event whose data is not JSON or breaks the shared schema. */
  | { type: "invalid"; name: string; reason: "bad_json" | "bad_shape" };

/** Validates each event against the shared zod schemas, so the UI never sees an off-contract payload. */
export function decodeAnalyzeEvent(raw: RawSseEvent): DecodedEvent {
  const schema =
    raw.event === SSE_EVENTS.status
      ? statusEventSchema
      : raw.event === SSE_EVENTS.result
        ? resultEventSchema
        : raw.event === SSE_EVENTS.error
          ? errorEventSchema
          : null;
  if (schema === null) return { type: "unknown", name: raw.event };

  let json: unknown;
  try {
    json = JSON.parse(raw.data);
  } catch {
    return { type: "invalid", name: raw.event, reason: "bad_json" };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { type: "invalid", name: raw.event, reason: "bad_shape" };
  // The schema was chosen by the event name, so the pairing below is exact.
  return { type: raw.event, data: parsed.data } as AnalyzeEvent;
}
