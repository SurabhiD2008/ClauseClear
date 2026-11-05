import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  analysisResultSchema,
  errorEventSchema,
  extractTranslatable,
  sampleFileSchema,
  sampleResponseSchema,
  samplesListResponseSchema,
} from "@clauseclear/shared";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SAMPLES_DIR, createApp } from "../app.js";
import { recordingRouter } from "../pipeline/testing/harness.js";
import { LOG_CANARY, testApp } from "./testing/api.js";

const errorOf = (res: request.Response) => errorEventSchema.parse(res.body);
const files = readdirSync(DEFAULT_SAMPLES_DIR)
  .filter((n) => n.endsWith(".json"))
  .sort();
const raw = (name: string) => readFileSync(path.join(DEFAULT_SAMPLES_DIR, name), "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

describe("the sample files", () => {
  it("are the three bundled samples", () => {
    expect(files).toEqual(["job-offer.json", "loan.json", "rental.json"]);
  });

  it.each(files)("%s validates against the shared schema, with hiReviewed false", (name) => {
    const sample = sampleFileSchema.parse(JSON.parse(raw(name)));
    expect(sample.hiReviewed).toBe(false);
    expect(`${sample.id}.json`).toBe(name);
  });

  it.each(files)("%s: hi covers every key of the translatable map of en", (name) => {
    const sample = sampleFileSchema.parse(JSON.parse(raw(name)));
    const keys = Object.keys(extractTranslatable(sample.en)).sort();
    expect(keys.length).toBeGreaterThan(20);
    expect(Object.keys(sample.hi).sort()).toEqual(keys);
    for (const key of keys) expect(sample.hi[key]?.trim()).not.toBe("");
  });

  it.each(files)("%s does not contain the log canary string", (name) => {
    expect(raw(name)).not.toContain(LOG_CANARY);
  });

  it.each(files)("%s: every present flag quotes its own segment", (name) => {
    const { en } = sampleFileSchema.parse(JSON.parse(raw(name)));
    const segments = new Map(en.segments.map((s) => [s.id, squash(s.text)]));
    for (const flag of en.flags.filter((f) => f.kind === "present")) {
      expect(segments.get(flag.segmentId ?? "")).toContain(squash(flag.quote ?? "-"));
    }
  });

  it("the schema rejects hi with a missing or an extra key", () => {
    const sample = sampleFileSchema.parse(JSON.parse(raw("rental.json")));
    const [first = ""] = Object.keys(sample.hi);
    const missing = {
      ...sample,
      hi: Object.fromEntries(Object.entries(sample.hi).filter(([k]) => k !== first)),
    };
    expect(sampleFileSchema.safeParse(missing).error?.issues[0]?.path).toEqual(["hi", first]);
    const extra = { ...sample, hi: { ...sample.hi, "flags.f1.quote": "x" } };
    expect(sampleFileSchema.safeParse(extra).success).toBe(false);
    expect(sampleFileSchema.safeParse({ ...sample, hiReviewed: undefined }).success).toBe(false);
  });
});

describe("startup check", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const appWith = (edit: (d: string) => void) => {
    dir = mkdtempSync(path.join(tmpdir(), "cc-samples-"));
    cpSync(DEFAULT_SAMPLES_DIR, dir, { recursive: true });
    edit(dir);
    const samplesDir = dir;
    return () =>
      createApp({
        router: recordingRouter().router,
        maxInputTokens: 24_000,
        budgetMs: 100_000,
        samplesDir,
      });
  };

  it("builds the app when every sample is valid", () => {
    const unchangedCopy = (): void => {
      // the copied samples as they are
    };
    expect(appWith(unchangedCopy)).not.toThrow();
  });

  it("refuses to build the app when a sample is invalid, naming the file and path", () => {
    const build = appWith((d) => {
      const file = path.join(d, "loan.json");
      const sample = JSON.parse(readFileSync(file, "utf8")) as { hi: Record<string, string> };
      delete sample.hi.summary;
      writeFileSync(file, JSON.stringify(sample));
    });
    expect(build).toThrow("sample loan.json is invalid at hi.summary (missing)");
  });

  it("refuses to build the app on a file that is not JSON, or no samples at all", () => {
    expect(
      appWith((d) => {
        writeFileSync(path.join(d, "rental.json"), "{");
      }),
    ).toThrow("sample rental.json is not valid JSON");
    expect(
      appWith((d) => {
        for (const f of readdirSync(d)) rmSync(path.join(d, f));
      }),
    ).toThrow("no sample files");
  });
});

describe("GET /api/samples", () => {
  it("lists the three bundled samples and serves each with zero provider calls", async () => {
    const { app, recorder } = testApp();
    const generate = vi.spyOn(recorder.router, "generate");
    const list = samplesListResponseSchema.parse((await request(app).get("/api/samples")).body);
    expect(list.map((s) => [s.id, s.docType])).toEqual([
      ["job-offer", "employment"],
      ["loan", "loan"],
      ["rental", "rental"],
    ]);
    for (const { id } of list) {
      const res = await request(app).get(`/api/samples/${id}`);
      expect(res.status).toBe(200);
      const sample = sampleResponseSchema.parse(res.body);
      expect(analysisResultSchema.safeParse(sample.en).success).toBe(true);
      expect(Object.keys(sample.hi).sort()).toEqual(
        Object.keys(extractTranslatable(sample.en)).sort(),
      );
      // The response is { en, hi } only (SPEC section 7).
      expect(Object.keys(res.body as object).sort()).toEqual(["en", "hi"]);
    }
    expect(generate).not.toHaveBeenCalled();
    expect(recorder.requests).toHaveLength(0);
  });

  it("an unknown id is NOT_FOUND, with zero provider calls", async () => {
    const { app, recorder } = testApp();
    const generate = vi.spyOn(recorder.router, "generate");
    const res = await request(app).get("/api/samples/lease");
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("NOT_FOUND");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("GET /api/samples/:id compression (prompt 19, A179)", () => {
  it("answers brotli when asked, plain JSON otherwise, with the same body", async () => {
    const app = createApp();
    const plain = await request(app).get("/api/samples/rental").set("Accept-Encoding", "identity");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.headers["cache-control"]).toBe("no-store");
    // Supertest decodes brotli, so the parsed body must equal the plain one.
    const br = await request(app).get("/api/samples/rental").set("Accept-Encoding", "br");
    expect(br.headers["content-encoding"]).toBe("br");
    expect(Number(br.headers["content-length"])).toBeLessThan(plain.text.length / 3);
    expect(br.body).toEqual(plain.body);
  });
});
