// Concurrency: two requests released together against a limit with room for
// one. Each race runs 20 times; every time exactly one wins, the other gets
// RATE_LIMITED, and only the winner reaches the model.
import { errorEventSchema } from "@clauseclear/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { legalText, testApp } from "./testing/api.js";

const ITERATIONS = 20;

async function race(send: () => request.Test): Promise<number[]> {
  const responses = await Promise.all([send(), send()]);
  for (const res of responses)
    if (res.status === 429) expect(errorEventSchema.parse(res.body).code).toBe("RATE_LIMITED");
  return responses.map((r) => r.status).sort();
}

describe("races at a limit with room for one", () => {
  it("the daily analysis cap: one 200, one 429, one analysis", async () => {
    // The model calls one analysis of this text makes, to compare each race against.
    const single = testApp();
    await request(single.app)
      .post("/api/analyze?stream=0")
      .send({ text: legalText(600) });
    const callsForOne = single.recorder.requests.length;
    for (let i = 0; i < ITERATIONS; i++) {
      const { app, recorder } = testApp({
        app: { limits: { ipAnalyses: 1_000, dailyAnalyses: 1 } },
      });
      const statuses = await race(() =>
        request(app)
          .post("/api/analyze?stream=0")
          .send({ text: legalText(600) }),
      );
      expect(statuses).toEqual([200, 429]);
      expect(callsForOne).toBeGreaterThan(0);
      expect(recorder.requests).toHaveLength(callsForOne);
    }
  }, 60_000);

  it("the per-visitor analysis limit: one 200, one 429", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const { app } = testApp({ app: { limits: { ipAnalyses: 1, dailyAnalyses: 1_000 } } });
      const statuses = await race(() =>
        request(app)
          .post("/api/analyze?stream=0")
          .send({ text: legalText(600) }),
      );
      expect(statuses).toEqual([200, 429]);
    }
  }, 60_000);

  it("the daily translation cap: one 200, one 429, one set of model calls", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const { app, recorder } = testApp({ app: { limits: { dailyTranslations: 1 } } });
      const body = { lang: "hi", strings: { summary: "The rent is Rs. 20,000 each month." } };
      const statuses = await race(() => request(app).post("/api/translate").send(body));
      expect(statuses).toEqual([200, 429]);
      expect(recorder.requests).toHaveLength(1);
    }
  }, 60_000);
});
