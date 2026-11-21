import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  ENV_DEFAULTS,
  IP_WINDOW_MS,
  errorEventSchema,
  type AnalysisResult,
} from "@clauseclear/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRouterFromConfig, readLlmConfig } from "../llm/index.js";
import { createLogger } from "../logger.js";
import { createApp } from "../app.js";
import { fixtureSegments } from "../pipeline/testing/harness.js";
import {
  doc,
  docBytes,
  legalText,
  parseSse,
  testApp,
  type SseEvent,
  LOG_CANARY,
} from "./testing/api.js";

const rentalText = async () =>
  (await fixtureSegments("rental.pdf")).segments.map((s) => s.text).join("\n\n");

const errorOf = (res: request.Response) => errorEventSchema.parse(res.body);

function lastEvent(events: SseEvent[]): SseEvent | undefined {
  return events[events.length - 1];
}

describe("client abort", () => {
  it("a disconnect mid-analysis logs CANCELLED and no provider call starts afterwards", async () => {
    // A 1-token input budget forces one chunk per segment: many calls, two at a time.
    const t = testApp({ recorder: { delayMs: 150 }, app: { maxInputTokens: 1 } });
    const server = t.app.listen(0);
    const { port } = server.address() as AddressInfo;
    const body = JSON.stringify({ text: await rentalText(), docType: "rental" });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          port,
          method: "POST",
          path: "/api/analyze",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let seen = "";
          res.on("data", (chunk: Buffer) => {
            seen += chunk.toString("utf8");
            if (seen.includes("read part 1 of")) {
              req.destroy();
              resolve();
            }
          });
          res.on("end", () => {
            reject(new Error("the stream ended before the abort"));
          });
        },
      );
      req.on("error", () => undefined);
      req.end(body);
    });

    const ended = async () => {
      for (let i = 0; i < 100; i += 1) {
        const end = t.logLines().find((l) => l.event === "analysis_end");
        if (end !== undefined) return end;
        await new Promise((r) => setTimeout(r, 30));
      }
      return undefined;
    };
    expect(await ended()).toMatchObject({ event: "analysis_end", outcome: "CANCELLED" });
    const callsAtCancel = t.recorder.requests.length;
    await new Promise((r) => setTimeout(r, 600));
    expect(t.recorder.requests.length).toBe(callsAtCancel);
    // The chunked run would have needed more calls than were made.
    const full = testApp({ app: { maxInputTokens: 1 } });
    await request(full.app)
      .post("/api/analyze?stream=0")
      .send(JSON.parse(body) as object);
    expect(callsAtCancel).toBeLessThan(full.recorder.requests.length);
    server.close();
  });
});

describe("abuse limits", () => {
  it("the per-IP limit answers RATE_LIMITED with retryAfterSec within the window", async () => {
    const { app } = testApp({ app: { limits: { ipAnalyses: 2, dailyAnalyses: 1_000 } } });
    const post = () =>
      request(app)
        .post("/api/analyze?stream=0")
        .send({ text: legalText(50) });
    expect((await post()).status).toBe(422);
    expect((await post()).status).toBe(422);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(errorOf(limited).code).toBe("RATE_LIMITED");
    expect(errorOf(limited).retryAfterSec).toBeGreaterThan(0);
    expect(errorOf(limited).retryAfterSec).toBeLessThanOrEqual(IP_WINDOW_MS / 1000);
    expect(limited.headers["retry-after"]).toBe(String(errorOf(limited).retryAfterSec));
    expect(limited.headers.ratelimit).toBeDefined();
  });

  it("the global daily cap answers RATE_LIMITED until midnight Pacific", async () => {
    const { app, recorder } = testApp({ app: { limits: { ipAnalyses: 1_000, dailyAnalyses: 1 } } });
    const post = () => request(app).post("/api/analyze?stream=0").attach("file", doc("rental.pdf"));
    expect((await post()).status).toBe(200);
    const capped = await post();
    expect(capped.status).toBe(429);
    expect(errorOf(capped).code).toBe("RATE_LIMITED");
    expect(errorOf(capped).retryAfterSec).toBeGreaterThan(0);
    expect(errorOf(capped).retryAfterSec).toBeLessThanOrEqual(86_400);
    expect(recorder.requests).toHaveLength(1);
  });

  it(`10 parallel analyses never have more than LLM_CONCURRENCY (${String(ENV_DEFAULTS.LLM_CONCURRENCY)}) calls in flight`, async () => {
    // 400 ms per call: PDFs parse in workers two at a time, so on a loaded
    // machine a shorter call could finish before the next parse does and the peak
    // would read 1 without any change in the queue.
    const { app, recorder } = testApp({ recorder: { delayMs: 400 } });
    const pdf = await docBytes("rental.pdf");
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post("/api/analyze?stream=0")
          .attach("file", pdf, { filename: "rental.pdf", contentType: "application/pdf" }),
      ),
    );
    for (const res of responses) expect(res.status).toBe(200);
    expect(recorder.requests).toHaveLength(10);
    // The cap is the property under test. That the queue does fill to the cap is
    // proven without timing in limiter.test.ts; here, on a loaded machine, PDF
    // parsing can leave fewer calls in flight, so only the upper bound is fixed.
    expect(recorder.peakInFlight()).toBeGreaterThanOrEqual(1);
    expect(recorder.peakInFlight()).toBeLessThanOrEqual(ENV_DEFAULTS.LLM_CONCURRENCY);
  }, 30_000);
});

describe("logs", () => {
  const CANARY = LOG_CANARY;
  const FAKE_KEY = "AIzaFAKE-canary-key-0123456789abcdef";

  it("never contain the document text, quotes or keys (canary fixture)", async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      destination: {
        write(chunk: string) {
          lines.push(chunk);
        },
      },
    });
    // The real config path with the mock provider, so llm_call lines are captured too.
    const config = readLlmConfig({ LLM_PROVIDER_ORDER: "mock", GEMINI_API_KEY: FAKE_KEY });
    const router = createRouterFromConfig(config, (entry) => {
      logger.info(entry);
    });
    const app = createApp({
      router,
      maxInputTokens: config.maxInputTokens,
      budgetMs: config.budgetMs,
      limits: { ipAnalyses: 1_000, dailyAnalyses: 1_000 },
      logger,
      nodeEnv: "test",
    });

    const streamed = await request(app)
      .post("/api/analyze")
      .set("Authorization", `Bearer ${FAKE_KEY}`)
      .set("x-api-key", FAKE_KEY)
      .attach("file", doc("log-canary.pdf"));
    const result = lastEvent(parseSse(streamed.text))?.data as AnalysisResult;
    const plain = await request(app)
      .post("/api/analyze?stream=0")
      .attach("file", doc("log-canary.pdf"));
    const text = result.segments.map((s) => s.text).join("\n\n");
    await request(app).post("/api/analyze").send({ text });
    await request(app).post("/api/analyze").set("x-mock-scenario", "not_legal").send({ text });
    await request(app)
      .post("/api/analyze")
      .send({ text: `${CANARY} too short` });

    // The canary really went through: it is in a verified quote of the result.
    expect(plain.status).toBe(200);
    const quotes = result.flags.flatMap((f) => (f.quote === undefined ? [] : [f.quote]));
    expect(quotes.some((q) => q.includes(CANARY))).toBe(true);

    const logs = lines.join("");
    const events = lines.map((l) => (JSON.parse(l) as { event?: string }).event);
    expect(events).toContain("analysis_start");
    expect(events).toContain("analysis_end");
    expect(events).toContain("llm_call");
    expect(events).toContain("analysis_rejected");
    expect(logs).not.toContain(CANARY);
    expect(logs).not.toContain(FAKE_KEY);
    for (const quote of quotes) expect(logs).not.toContain(quote);
    for (const segment of result.segments) expect(logs).not.toContain(segment.text);
  });
});
