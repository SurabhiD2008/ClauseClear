import {
  ERROR_DEFINITIONS,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  PIPELINE_STEPS,
  analysisResultSchema,
  errorEventSchema,
  statusEventSchema,
  type ErrorCode,
} from "@clauseclear/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { fixtureSegments } from "../pipeline/testing/harness.js";
import { toErrorBody } from "./errors.js";
import { doc, legalText, parseSse, testApp, type SseEvent } from "./testing/api.js";

const rentalText = async () =>
  (await fixtureSegments("rental.pdf")).segments.map((s) => s.text).join("\n\n");

const errorOf = (res: request.Response) => errorEventSchema.parse(res.body);

function lastEvent(events: SseEvent[]): SseEvent | undefined {
  return events[events.length - 1];
}

/** Steps in the order they were first reported. */
function stepOrder(events: SseEvent[]): string[] {
  const steps: string[] = [];
  for (const e of events) {
    if (e.event !== "status") continue;
    const { step } = statusEventSchema.parse(e.data);
    if (steps[steps.length - 1] !== step) steps.push(step);
  }
  return steps;
}

describe("POST /api/analyze: server-sent events", () => {
  it("streams status events in pipeline order, then exactly one result", async () => {
    const { app } = testApp();
    const res = await request(app).post("/api/analyze").attach("file", doc("rental.pdf"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store, no-transform");

    const events = parseSse(res.text);
    expect(stepOrder(events)).toEqual([...PIPELINE_STEPS]);
    expect(events.filter((e) => e.event === "result")).toHaveLength(1);
    expect(events.filter((e) => e.event === "error")).toHaveLength(0);
    expect(lastEvent(events)?.event).toBe("result");
    const result = analysisResultSchema.parse(lastEvent(events)?.data);
    expect(result.docType).toBe("rental");
    expect(result.flags.length).toBeGreaterThan(0);
  });

  it("accepts JSON text with a docType override", async () => {
    const { app } = testApp();
    const res = await request(app)
      .post("/api/analyze")
      .send({ text: await rentalText(), docType: "rental" });
    const events = parseSse(res.text);
    expect(stepOrder(events)).toEqual([...PIPELINE_STEPS]);
    expect(analysisResultSchema.parse(lastEvent(events)?.data).stats.pages).toBe(1);
  });

  it("?stream=0 returns the same result as plain JSON", async () => {
    const { app } = testApp();
    const plain = await request(app)
      .post("/api/analyze?stream=0")
      .attach("file", doc("rental.pdf"));
    expect(plain.status).toBe(200);
    expect(plain.headers["content-type"]).toMatch(/^application\/json/);
    const result = analysisResultSchema.parse(plain.body);
    const streamed = await request(app).post("/api/analyze").attach("file", doc("rental.pdf"));
    expect(lastEvent(parseSse(streamed.text))?.data).toEqual(result);
  });

  it("sends the strict CSP and no CORS headers", async () => {
    const { app } = testApp();
    const res = await request(app)
      .post("/api/analyze?stream=0")
      .set("Origin", "https://evil.example")
      .send({ text: "short" });
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("the trust step through the API", () => {
  it("hallucinated quotes are all dropped; the result says partial_verification", async () => {
    const { app, recorder } = testApp();
    const res = await request(app)
      .post("/api/analyze?stream=0")
      .set("x-mock-scenario", "hallucinated_quotes")
      .attach("file", doc("rental.pdf"));
    expect(res.status).toBe(200);
    const result = analysisResultSchema.parse(res.body);
    expect(JSON.stringify(result)).not.toContain("pet elephant");
    expect(result.flags.filter((f) => f.kind === "present")).toEqual([]);
    expect(result.warnings).toContain("partial_verification");
    // One strict retry, no more.
    expect(recorder.requests).toHaveLength(2);
  });

  it("half-wrong quotes (5 of 9 fail) trigger exactly one strict retry", async () => {
    const { app, recorder } = testApp();
    const res = await request(app)
      .post("/api/analyze")
      .set("x-mock-scenario", "half_wrong_quotes")
      .attach("file", doc("rental.pdf"));
    const events = parseSse(res.text);
    expect(recorder.requests).toHaveLength(2);
    expect(recorder.requests[1]?.system).toContain("This is a second attempt");
    expect(
      events.some(
        (e) =>
          e.event === "status" &&
          (e.data as { detail?: string }).detail === "checking again with a stricter reading",
      ),
    ).toBe(true);
    const result = analysisResultSchema.parse(lastEvent(events)?.data);
    expect(result.warnings).toEqual(["partial_verification"]);
    for (const f of result.flags.filter((x) => x.kind === "present")) {
      const segment = result.segments.find((s) => s.id === f.segmentId);
      expect(segment?.text).toContain(f.quote);
    }
  });

  it("the mock header is ignored outside NODE_ENV=test", async () => {
    const { app, recorder } = testApp({ app: { nodeEnv: "production" } });
    const res = await request(app)
      .post("/api/analyze?stream=0")
      .set("x-mock-scenario", "not_legal")
      .attach("file", doc("rental.pdf"));
    expect(res.status).toBe(200);
    expect(recorder.requests).toHaveLength(1);
  });
});

describe("every error code", () => {
  const expectHttpError = (res: request.Response, code: ErrorCode) => {
    expect(res.status).toBe(ERROR_DEFINITIONS[code].status);
    expect(errorEventSchema.parse(res.body).code).toBe(code);
  };

  describe("before the stream starts: HTTP status and error body", () => {
    it("BAD_REQUEST: no body, wrong content type, bad JSON, wrong shape, no file, unknown docType, empty file", async () => {
      const { app, recorder } = testApp();
      const post = () => request(app).post("/api/analyze");
      const cases = [
        await post(),
        await post().set("Content-Type", "text/plain").send("hello"),
        await post().set("Content-Type", "application/json").send('{"text": '),
        await post().send({ text: legalText(500), extra: true }),
        await post().send({ body: legalText(500) }),
        await post().send({ text: legalText(500), docType: "lease" }),
        await post().field("docType", "rental"),
        await post().attach("upload", doc("rental.pdf")),
        await post().attach("file", doc("rental.pdf")).field("docType", "lease"),
        await post().attach("file", doc("empty.pdf")),
      ];
      for (const res of cases) expectHttpError(res, "BAD_REQUEST");
      expect(recorder.requests).toHaveLength(0);
    });

    it("FILE_TOO_LARGE: one byte over the limit is refused at the parser", async () => {
      const { app } = testApp();
      const big = Buffer.alloc(MAX_FILE_BYTES + 1, 0x20);
      big.write("%PDF-1.7\n");
      const res = await request(app)
        .post("/api/analyze")
        .attach("file", big, { filename: "big.pdf", contentType: "application/pdf" });
      expectHttpError(res, "FILE_TOO_LARGE");
    });

    it("NOT_PDF: a text file renamed .pdf", async () => {
      const { app } = testApp();
      expectHttpError(
        await request(app).post("/api/analyze").attach("file", doc("text-renamed.pdf")),
        "NOT_PDF",
      );
    });

    it("TEXT_TOO_SHORT, TEXT_TOO_LONG (by characters and by body size) and NOT_ENGLISH", async () => {
      const { app, recorder } = testApp();
      const post = (body: object) => request(app).post("/api/analyze").send(body);
      expectHttpError(await post({ text: legalText(199) }), "TEXT_TOO_SHORT");
      expectHttpError(await post({ text: legalText(MAX_TEXT_CHARS + 1) }), "TEXT_TOO_LONG");
      expectHttpError(await post({ text: legalText(600_000) }), "TEXT_TOO_LONG");
      expectHttpError(await post({ text: `${legalText(400)} किराया` }), "NOT_ENGLISH");
      expect(recorder.requests).toHaveLength(0);
    });

    it("NOT_FOUND: unknown API path", async () => {
      const { app } = testApp();
      expectHttpError(await request(app).get("/api/nothing-here"), "NOT_FOUND");
    });
  });

  describe("after the stream starts: an error event (and the HTTP status with ?stream=0)", () => {
    const cases: [ErrorCode, string, string | undefined][] = [
      ["PDF_ENCRYPTED", "encrypted.pdf", undefined],
      ["TOO_MANY_PAGES", "over-25-pages.pdf", undefined],
      ["NO_TEXT", "scan-no-text.pdf", undefined],
      ["NOT_LEGAL", "rental.pdf", "not_legal"],
      ["ANALYSIS_FAILED", "rental.pdf", "malformed_json"],
      ["ANALYSIS_FAILED", "rental.pdf", "wrong_schema"],
      ["ANALYSIS_FAILED", "rental.pdf", "refusal"],
    ];
    for (const [code, file, scenario] of cases) {
      it(`${code}${scenario === undefined ? "" : ` (mock: ${scenario})`}`, async () => {
        const { app } = testApp();
        const streamed = request(app).post("/api/analyze").attach("file", doc(file));
        if (scenario !== undefined) void streamed.set("x-mock-scenario", scenario);
        const res = await streamed;
        expect(res.status).toBe(200);
        const events = parseSse(res.text);
        expect(events[0]).toEqual({ event: "status", data: { step: "reading" } });
        expect(events.filter((e) => e.event === "error")).toHaveLength(1);
        expect(lastEvent(events)?.event).toBe("error");
        expect(errorEventSchema.parse(lastEvent(events)?.data).code).toBe(code);

        const plain = request(app).post("/api/analyze?stream=0").attach("file", doc(file));
        if (scenario !== undefined) void plain.set("x-mock-scenario", scenario);
        expectHttpError(await plain, code);
      });
    }

    it("JSON wrapped in prose and a code fence is still read (mock: prose_wrapped)", async () => {
      const { app } = testApp();
      const res = await request(app)
        .post("/api/analyze?stream=0")
        .set("x-mock-scenario", "prose_wrapped")
        .attach("file", doc("rental.pdf"));
      expect(res.status).toBe(200);
      expect(analysisResultSchema.parse(res.body).flags.length).toBeGreaterThan(0);
    });

    it("RATE_LIMITED from the providers carries retryAfterSec (mock: rate_limit)", async () => {
      const { app } = testApp({ app: { budgetMs: 1_500 } });
      const res = await request(app)
        .post("/api/analyze?stream=0")
        .set("x-mock-scenario", "rate_limit")
        .attach("file", doc("rental.pdf"));
      expectHttpError(res, "RATE_LIMITED");
      expect(errorOf(res).retryAfterSec).toBeGreaterThan(0);
      expect(res.headers["retry-after"]).toBe(String(errorOf(res).retryAfterSec));
    }, 15_000);

    it("PROVIDER_UNAVAILABLE when every provider fails (mock: server_error)", async () => {
      const { app } = testApp({ app: { budgetMs: 1_500 } });
      const res = await request(app)
        .post("/api/analyze")
        .set("x-mock-scenario", "server_error")
        .attach("file", doc("rental.pdf"));
      expect(errorEventSchema.parse(lastEvent(parseSse(res.text))?.data).code).toBe(
        "PROVIDER_UNAVAILABLE",
      );
    }, 15_000);

    it("CANCELLED is the code for any failure once the client has gone", () => {
      const controller = new AbortController();
      controller.abort();
      expect(
        toErrorBody(new Error("whatever the aborted work threw"), controller.signal).code,
      ).toBe("CANCELLED");
    });
  });
});
