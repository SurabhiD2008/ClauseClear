import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { PERMISSIONS_POLICY, createApp } from "../app.js";

describe("GET /api/health", () => {
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it("returns status only", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("never echoes a configured key", async () => {
    process.env.GEMINI_API_KEY = "test-key-not-real-1234567890";
    const res = await request(createApp()).get("/api/health");
    expect(res.text).not.toContain("test-key-not-real-1234567890");
  });

  it("sends the strict CSP from SPEC section 11", async () => {
    const res = await request(createApp()).get("/api/health");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("refuses device features and keeps API answers out of every cache (A176)", async () => {
    const app = createApp();
    for (const path of ["/api/health", "/api/samples/rental", "/api/nope"]) {
      const res = await request(app).get(path);
      expect(res.headers["permissions-policy"], path).toBe(PERMISSIONS_POLICY);
      expect(res.headers["cache-control"], path).toBe("no-store");
      expect(res.headers["access-control-allow-origin"], path).toBeUndefined();
    }
    const preflight = await request(app)
      .options("/api/analyze")
      .set("Origin", "https://elsewhere.example")
      .set("Access-Control-Request-Method", "POST");
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns the shared NOT_FOUND error body for unknown API paths", async () => {
    const res = await request(createApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ code: "NOT_FOUND", message: "Not found." });
  });
});
