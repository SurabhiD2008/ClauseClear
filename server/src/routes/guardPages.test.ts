import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";

const guardPagesDir = fileURLToPath(new URL("../../../client/e2e/guard-pages", import.meta.url));

// The oddity guard's broken pages (prompt 16) exist only when index.ts is told
// to serve them (E2E_GUARD_PAGES=1). Without the option nothing is mounted.
describe("/__guard test pages", () => {
  it("are not served unless the option is set", async () => {
    const res = await request(createApp()).get("/__guard/clean.html");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("Guard control page");
  });

  it("are served with the option, under the same CSP apart from local connect-src", async () => {
    const res = await request(createApp({ guardPagesDir })).get("/__guard/clean.html");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Guard control page");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' http://localhost:* http://127.0.0.1:*");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
