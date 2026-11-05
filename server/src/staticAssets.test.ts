// Compressed client assets (prompt 19, A179).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { IMMUTABLE, pickEncoding } from "./staticAssets.js";

const dist = mkdtempSync(path.join(tmpdir(), "cc-dist-"));
mkdirSync(path.join(dist, "assets"));
const script = `console.log(${JSON.stringify("x".repeat(5000))});\n`;
const index = `<!doctype html><html lang="en"><head><title>t</title></head><body>${"<p>p</p>".repeat(200)}</body></html>`;
writeFileSync(path.join(dist, "assets", "index-abc.js"), script);
writeFileSync(path.join(dist, "assets", "font-abc.woff2"), Buffer.alloc(2000, 7));
writeFileSync(path.join(dist, "index.html"), index);
const app = createApp({ clientDist: dist });

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** Supertest and fetch decode brotli and gzip themselves; node:http gives the bytes as sent. */
async function rawGet(urlPath: string, acceptEncoding: string): Promise<RawResponse> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise((resolve, reject) => {
      http
        .get({ port, path: urlPath, headers: { "accept-encoding": acceptEncoding } }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
        })
        .on("error", reject);
    });
  } finally {
    server.close();
  }
}

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe("pickEncoding", () => {
  it("prefers brotli, falls back to gzip, honours q=0 and *", () => {
    expect(pickEncoding("gzip, deflate, br")).toBe("br");
    expect(pickEncoding("gzip")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip")).toBe("gzip");
    expect(pickEncoding("*")).toBe("br");
    expect(pickEncoding("identity")).toBeUndefined();
    expect(pickEncoding(undefined)).toBeUndefined();
  });
});

describe("compressed client assets", () => {
  it("sends brotli or gzip by Accept-Encoding, with the same bytes inside", async () => {
    const br = await rawGet("/assets/index-abc.js", "br");
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers.vary).toContain("Accept-Encoding");
    expect(br.headers["cache-control"]).toBe(IMMUTABLE);
    expect(br.headers["content-type"]).toMatch(/^text\/javascript/);
    expect(br.body.byteLength).toBeLessThan(script.length / 10);
    expect(brotliDecompressSync(br.body).toString()).toBe(script);

    const gz = await rawGet("/assets/index-abc.js", "gzip");
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gz.body).toString()).toBe(script);

    const plain = await rawGet("/assets/index-abc.js", "identity");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body.toString()).toBe(script);
  });

  it("serves the SPA fallback compressed and never cached as immutable", async () => {
    const res = await rawGet("/results/sample/rental", "br");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(brotliDecompressSync(res.body).toString()).toBe(index);
    // The security headers still apply.
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("leaves fonts to express.static, uncompressed but immutable", async () => {
    const res = await request(app).get("/assets/font-abc.woff2").set("Accept-Encoding", "br");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe(IMMUTABLE);
  });

  it("never compresses API answers through this path", async () => {
    const res = await request(app).get("/api/health").set("Accept-Encoding", "br");
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body).toEqual({ ok: true });
  });
});
