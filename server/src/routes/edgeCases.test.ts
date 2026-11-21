// The edge-case catalogue, table-driven, on every API input surface. Each row
// asserts a defined outcome: a valid result or the documented refusal. A 500, a
// hang or silent acceptance of a bad value fails the row.
import {
  analysisResultSchema,
  errorEventSchema,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
} from "@clauseclear/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { legalText, testApp } from "./testing/api.js";

const errorCode = (res: request.Response) => errorEventSchema.parse(res.body).code;
const lease = legalText(600);

/** Text rows: [label, text, expected status, expected code when refused]. */
const TEXT_ROWS: [string, string, number, string?][] = [
  ["empty", "", 422, "TEXT_TOO_SHORT"],
  ["whitespace only", " \n\t ".repeat(100), 422, "TEXT_TOO_SHORT"],
  ["one character", "a", 422, "TEXT_TOO_SHORT"],
  ["one below the minimum", legalText(MIN_TEXT_CHARS - 1), 422, "TEXT_TOO_SHORT"],
  ["exactly the minimum", legalText(MIN_TEXT_CHARS), 200],
  ["exactly the maximum", legalText(MAX_TEXT_CHARS), 200],
  ["maximum plus one", legalText(MAX_TEXT_CHARS + 1), 422, "TEXT_TOO_LONG"],
  ["leading and trailing spaces", `   ${lease}   `, 200],
  ["Devanagari", `${lease} किराया`, 422, "NOT_ENGLISH"],
  ["emoji with joiners", `${lease} 👩‍👩‍👧 family`, 200],
  ["right-to-left text", `${lease} مرحبا`, 200],
  ["combining marks (decomposed)", `${lease} café résumé`, 200],
  ["null byte and control characters", `${lease}\u0000\u0007\u001b end`, 200],
  ["one very long unbroken token", `${lease} ${"x".repeat(5_000)}`, 200],
  ["markup and script tags", `${lease} <script>alert(1)</script><img src=x onerror=alert(1)>`, 200],
  ["query-like fragment", `${lease} '; DROP TABLE users; -- OR 1=1`, 200],
  ["path traversal", `${lease} ../../etc/passwd ..\\..\\windows`, 200],
  ["template syntax", `${lease} {{constructor.constructor('x')()}} \${process.env}`, 200],
  ["CR and LF", `${lease.slice(0, 300)}\r\n\r\n${lease.slice(300)}`, 200],
];

describe("edge cases: POST /api/analyze text", () => {
  for (const [label, text, status, code] of TEXT_ROWS) {
    it(`${label}: ${code ?? String(status)}`, async () => {
      const { app } = testApp();
      const res = await request(app).post("/api/analyze?stream=0").send({ text });
      expect(res.status).toBe(status);
      if (code !== undefined) expect(errorCode(res)).toBe(code);
      else {
        const result = analysisResultSchema.parse(res.body);
        // Control characters never reach the viewer; markup stays plain text.
        expect(
          result.segments.some((s) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s.text)),
        ).toBe(false);
      }
    }, 20_000);
  }
});

/** Payload rows: [label, content type, raw body]. Every one is BAD_REQUEST with no model call. */
const PAYLOAD_ROWS: [string, string, string][] = [
  ["missing required field", "application/json", JSON.stringify({ docType: "rental" })],
  ["unknown extra field", "application/json", JSON.stringify({ text: lease, extra: 1 })],
  ["wrong type", "application/json", JSON.stringify({ text: 42 })],
  ["null instead of a string", "application/json", JSON.stringify({ text: null })],
  ["array where an object is expected", "application/json", JSON.stringify([lease])],
  ["deep nesting", "application/json", `${'{"a":'.repeat(500)}1${"}".repeat(500)}`],
  [
    "privileged fields",
    "application/json",
    JSON.stringify({ text: lease, score: 0, flags: [], role: "admin" }),
  ],
  ["wrong content type", "text/plain", lease],
  ["malformed body", "application/json", '{"text": "unterminated'],
  ["empty body", "application/json", ""],
  ["unknown docType", "application/json", JSON.stringify({ text: lease, docType: "insurance" })],
];

describe("edge cases: request payloads", () => {
  for (const route of ["/api/analyze", "/api/translate"]) {
    for (const [label, type, body] of PAYLOAD_ROWS) {
      it(`${route}, ${label}: BAD_REQUEST and no model call`, async () => {
        const { app, recorder } = testApp();
        const res = await request(app).post(route).set("Content-Type", type).send(body);
        expect(res.status).toBe(400);
        expect(errorCode(res)).toBe("BAD_REQUEST");
        expect(recorder.requests).toHaveLength(0);
      });
    }
  }

  it("duplicate keys: the last value wins and is then validated", async () => {
    const { app } = testApp();
    const res = await request(app)
      .post("/api/analyze?stream=0")
      .set("Content-Type", "application/json")
      .send(`{"text": 1, "text": ${JSON.stringify(lease)}}`);
    expect(res.status).toBe(200);
  }, 20_000);

  it("an oversized body is refused before it is parsed", async () => {
    const { app, recorder } = testApp();
    const res = await request(app)
      .post("/api/translate")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ lang: "hi", strings: { summary: "x".repeat(2_000_000) } }));
    expect([400, 413]).toContain(res.status);
    expect(recorder.requests).toHaveLength(0);
  });
});

/** Identifier rows for GET /api/samples/:id. */
const ID_ROWS: string[] = [
  "does-not-exist",
  "RENTAL",
  "rental.json",
  "..%2F..%2Fpackage",
  "%00",
  "1",
  "a".repeat(500),
];

describe("edge cases: sample identifiers", () => {
  for (const id of ID_ROWS) {
    it(`"${id.slice(0, 20)}": NOT_FOUND`, async () => {
      const { app } = testApp();
      const res = await request(app).get(`/api/samples/${id}`);
      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe("NOT_FOUND");
    });
  }

  it("a path traversal attempt never reads a file outside the samples", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/samples/../../package.json");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("devDependencies");
  });
});

describe("edge cases: files", () => {
  const pdf = (bytes: Buffer, filename: string) =>
    request(testApp().app)
      .post("/api/analyze?stream=0")
      .attach("file", bytes, { filename, contentType: "application/pdf" });

  it("zero bytes: BAD_REQUEST", async () => {
    const res = await pdf(Buffer.alloc(0), "empty.pdf");
    expect(errorCode(res)).toBe("BAD_REQUEST");
  });

  it("extension and content disagree: NOT_PDF", async () => {
    const res = await pdf(Buffer.from("PK\u0003\u0004 a zip file"), "contract.pdf");
    expect(errorCode(res)).toBe("NOT_PDF");
  });

  it("a corrupted PDF: a defined refusal, never a 500", async () => {
    const res = await pdf(
      Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> broken"),
      "broken.pdf",
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  }, 30_000);

  it("names with paths, non-Latin characters, double extensions and great length are only names", async () => {
    for (const name of [
      "../../etc/passwd.pdf",
      "अनुबंध.pdf",
      "lease.pdf.exe",
      `${"n".repeat(300)}.pdf`,
    ]) {
      const res = await pdf(Buffer.from("not a pdf"), name);
      expect(errorCode(res)).toBe("NOT_PDF");
    }
  });
});
