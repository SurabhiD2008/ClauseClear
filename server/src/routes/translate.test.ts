import { readFileSync } from "node:fs";
import path from "node:path";
import {
  errorEventSchema,
  extractTranslatable,
  sampleFileSchema,
  translateResponseSchema,
  TRANSLATE_MAX_REQUEST_TOKENS,
} from "@clauseclear/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { DEFAULT_SAMPLES_DIR } from "../app.js";
import { MOCK_HINDI_PREFIX } from "../llm/mockModel.js";
import { testApp } from "./testing/api.js";

const errorOf = (res: request.Response) => errorEventSchema.parse(res.body);
const rental = sampleFileSchema.parse(
  JSON.parse(readFileSync(path.join(DEFAULT_SAMPLES_DIR, "rental.json"), "utf8")),
);

describe("POST /api/translate", () => {
  it("translates a result's whole translatable map in 1 to 3 calls, sending no quote or segment", async () => {
    const { app, recorder, logs } = testApp();
    const strings = extractTranslatable(rental.en);
    const res = await request(app).post("/api/translate").send({ lang: "hi", strings });
    expect(res.status).toBe(200);
    const body = translateResponseSchema.parse(res.body);
    expect(Object.keys(body.strings)).toEqual(Object.keys(strings));
    expect(body.unchanged).toEqual([]);
    expect(body.strings.summary).toBe(`${MOCK_HINDI_PREFIX}${strings.summary ?? ""}`);

    expect(recorder.requests.length).toBeGreaterThanOrEqual(1);
    expect(recorder.requests.length).toBeLessThanOrEqual(3);
    // What reached the model is exactly the translatable strings, nothing more:
    // no quote, segment, title or glossary term rides along.
    const sent: Record<string, string> = {};
    for (const r of recorder.requests) {
      const block =
        /=====BEGIN STRINGS ([0-9a-f]{8})=====\n([\s\S]*?)\n=====END STRINGS \1=====/.exec(r.user);
      Object.assign(sent, JSON.parse(block?.[2] ?? "{}") as Record<string, string>);
      expect(r.user.replace(block?.[0] ?? "", "").trim()).toBe("Translate each value into Hindi.");
    }
    for (const [key, value] of Object.entries(sent)) expect(value).toBe(strings[key]);
    expect(Object.keys(sent).sort()).toEqual(
      Object.keys(strings)
        .filter((k) => /[A-Za-z]/.test(strings[k] ?? ""))
        .sort(),
    );
    // The log line has counts only, never the strings.
    expect(logs()).toContain('"event":"translate_end"');
    expect(logs()).not.toContain(strings.summary ?? "-");
  });

  it("refuses a quote or segment key, or any key outside the translatable map, with no call", async () => {
    const { app, recorder } = testApp();
    for (const key of ["flags.f1.quote", "segments.s1.text", "title", "glossary.g1.term", "x"]) {
      const res = await request(app)
        .post("/api/translate")
        .send({ lang: "hi", strings: { summary: "A summary.", [key]: "Some text." } });
      expect(res.status, key).toBe(400);
      expect(errorOf(res).code).toBe("BAD_REQUEST");
    }
    expect(recorder.requests).toHaveLength(0);
  });

  it("refuses a request above 3 batches of strings", async () => {
    const { app, recorder } = testApp();
    const big = "word ".repeat(1_000);
    const count = Math.ceil((TRANSLATE_MAX_REQUEST_TOKENS * 4) / big.length) + 1;
    const strings = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`clauses.c${String(i)}.plain`, big]),
    );
    const res = await request(app).post("/api/translate").send({ lang: "hi", strings });
    expect(res.status).toBe(400);
    expect(recorder.requests).toHaveLength(0);
  });

  it("keeps a string whose numbers changed in English and lists it", async () => {
    const { app } = testApp({
      recorder: {
        override: (r) =>
          r.schemaName === "translation" ? JSON.stringify({ summary: "₹1 से कम" }) : undefined,
      },
    });
    const strings = { summary: "Rent is ₹25,000 a month." };
    const res = await request(app).post("/api/translate").send({ lang: "hi", strings });
    expect(res.status).toBe(200);
    expect(translateResponseSchema.parse(res.body)).toEqual({
      strings,
      unchanged: ["summary"],
    });
  });

  it("maps a model that never returns valid JSON to ANALYSIS_FAILED", async () => {
    const { app } = testApp({
      recorder: { override: (r) => (r.schemaName === "translation" ? "not json" : undefined) },
    });
    const res = await request(app)
      .post("/api/translate")
      .send({ lang: "hi", strings: { summary: "A summary." } });
    expect(res.status).toBe(500);
    expect(errorOf(res).code).toBe("ANALYSIS_FAILED");
  });

  it("rejects bad bodies as BAD_REQUEST", async () => {
    const { app } = testApp();
    for (const body of [{ lang: "fr", strings: {} }, { strings: {} }, "not json"]) {
      const bad = await request(app).post("/api/translate").send(body);
      expect(bad.status).toBe(400);
      expect(errorOf(bad).code).toBe("BAD_REQUEST");
    }
    const malformed = await request(app)
      .post("/api/translate")
      .set("Content-Type", "application/json")
      .send("{");
    expect(malformed.status).toBe(400);
    expect(errorOf(malformed).code).toBe("BAD_REQUEST");
  });

  it("an empty map answers at once with no call", async () => {
    const { app, recorder } = testApp();
    const res = await request(app).post("/api/translate").send({ lang: "hi", strings: {} });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ strings: {}, unchanged: [] });
    expect(recorder.requests).toHaveLength(0);
  });
});
