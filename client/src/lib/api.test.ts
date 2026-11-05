import { validResult } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { ApiError, createApi } from "./api";
import type { AnalyzeEvent } from "./sse";

/** A response whose body arrives in the given chunks, split anywhere. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

const event = (name: string, data: unknown) =>
  `event: ${name}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

async function collect(response: Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const api = createApi((url, init) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  });
  const events: AnalyzeEvent[] = [];
  const outcome = await api
    .streamAnalysis(
      { kind: "text", text: "hello" },
      { signal: new AbortController().signal, onEvent: (e) => events.push(e) },
    )
    .then(
      () => null,
      (error: unknown) => error,
    );
  return { calls, events, outcome };
}

describe("streamAnalysis", () => {
  it("posts JSON and delivers events in order across arbitrary chunk splits", async () => {
    const wire =
      event("status", { step: "reading" }) +
      ": keep-alive\n\n" +
      event("ping", "{}") +
      event("result", validResult());
    const chunks = wire.match(/[\s\S]{1,7}/g) ?? [];
    const { calls, events, outcome } = await collect(sseResponse(chunks));
    expect(outcome).toBeNull();
    expect(calls[0]?.url).toBe("/api/analyze");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"text":"hello"}');
    expect(events).toEqual([
      { type: "status", data: { step: "reading" } },
      { type: "result", data: validResult() },
    ]);
  });

  it("rejects with ANALYSIS_FAILED on bad JSON and stops delivering events", async () => {
    const { events, outcome } = await collect(
      sseResponse([
        event("status", { step: "reading" }),
        event("result", "{broken"),
        event("result", validResult()),
      ]),
    );
    expect(events).toHaveLength(1);
    expect(outcome).toBeInstanceOf(ApiError);
    expect((outcome as ApiError).code).toBe("ANALYSIS_FAILED");
  });

  it("an HTTP error before the stream carries the server's error body", async () => {
    const { outcome } = await collect(
      Response.json(
        { code: "RATE_LIMITED", message: "Too many requests.", retryAfterSec: 42 },
        { status: 429 },
      ),
    );
    expect((outcome as ApiError).body).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests.",
      retryAfterSec: 42,
    });
  });

  it("an error without a usable body is mapped from its status", async () => {
    const { outcome } = await collect(new Response("<html>bad gateway</html>", { status: 503 }));
    expect((outcome as ApiError).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("a 200 that is not an event stream is ANALYSIS_FAILED", async () => {
    const { outcome } = await collect(Response.json(validResult()));
    expect((outcome as ApiError).code).toBe("ANALYSIS_FAILED");
  });

  it("sends a file as multipart with the docType field first", async () => {
    let body: unknown;
    const api = createApi((_url, init) => {
      body = init?.body;
      return Promise.resolve(sseResponse([]));
    });
    await api.streamAnalysis(
      { kind: "file", file: new Blob(["%PDF-1.7"]), name: "lease.pdf", docType: "rental" },
      { signal: new AbortController().signal, onEvent: () => undefined },
    );
    expect(body).toBeInstanceOf(FormData);
    expect([...(body as FormData).keys()]).toEqual(["docType", "file"]);
  });
});

describe("JSON endpoints", () => {
  it("validates responses against the shared schemas", async () => {
    const api = createApi(() =>
      Promise.resolve(Response.json([{ id: "BAD ID", title: "x", docType: "rental" }])),
    );
    await expect(api.listSamples()).rejects.toMatchObject({ code: "ANALYSIS_FAILED" });
  });

  it("translate posts { lang: 'hi', strings }", async () => {
    let sent: unknown;
    const api = createApi((_url, init) => {
      sent = JSON.parse(init?.body as string);
      return Promise.resolve(Response.json({ strings: { summary: "सार" }, unchanged: [] }));
    });
    expect(await api.translate({ summary: "Summary" })).toEqual({
      strings: { summary: "सार" },
      unchanged: [],
    });
    expect(sent).toEqual({ lang: "hi", strings: { summary: "Summary" } });
  });
});
