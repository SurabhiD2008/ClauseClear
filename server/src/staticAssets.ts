// The built client, compressed once at startup (prompt 19 performance probe,
// A179). express.static sent the 410 KB script and 54 KB stylesheet raw; on
// Lighthouse's mobile throttling that alone cost about two seconds before first
// paint. No compression package is approved, so node:zlib does it: each text
// asset is kept in memory as brotli and gzip, chosen by Accept-Encoding. Fonts
// (woff2) are compressed already and go to express.static unchanged. Hashed
// files under /assets/ never change, so browsers may keep them for a year.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { NextFunction, Request, Response } from "express";

const COMPRESSIBLE: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
/** Files smaller than this are not worth an encoding. */
const MIN_BYTES = 1024;
export const IMMUTABLE = "public, max-age=31536000, immutable";

interface Variants {
  type: string;
  raw: Buffer;
  br: Buffer;
  gzip: Buffer;
}

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

/** Brotli first, then gzip, as the client accepts; q=0 refuses one. */
export function pickEncoding(accept: string | undefined): "br" | "gzip" | undefined {
  const offered = new Map<string, number>();
  for (const part of (accept ?? "").toLowerCase().split(",")) {
    const [name = "", ...params] = part.trim().split(";");
    const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find((v) => v !== undefined);
    offered.set(name.trim(), q === undefined ? 1 : Number(q));
  }
  const ok = (name: string) => (offered.get(name) ?? offered.get("*") ?? 0) > 0;
  if (ok("br")) return "br";
  if (ok("gzip")) return "gzip";
  return undefined;
}

export interface CompressedAssets {
  /** Serves a compressed file; calls next() for anything it does not hold. */
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** Sends index.html the same way (the SPA fallback). */
  sendIndex: (req: Request, res: Response) => void;
  /** URL paths held, for tests. */
  paths: string[];
}

export function compressedAssets(clientDist: string): CompressedAssets {
  const files = new Map<string, Variants>();
  for (const relative of walk(clientDist)) {
    const type = COMPRESSIBLE[path.extname(relative)];
    if (type === undefined) continue;
    const raw = readFileSync(path.join(clientDist, relative));
    if (raw.byteLength < MIN_BYTES) continue;
    files.set(`/${relative.split(path.sep).join("/")}`, {
      type,
      raw,
      br: brotliCompressSync(raw, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
        },
      }),
      gzip: gzipSync(raw, { level: 9 }),
    });
  }

  const send = (req: Request, res: Response, file: Variants, cache: string) => {
    const encoding = pickEncoding(req.headers["accept-encoding"]);
    const body = encoding === undefined ? file.raw : file[encoding];
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Type", file.type);
    res.setHeader("Cache-Control", cache);
    if (encoding !== undefined) res.setHeader("Content-Encoding", encoding);
    res.setHeader("Content-Length", String(body.byteLength));
    res.status(200).end(req.method === "HEAD" ? undefined : body);
  };

  return {
    paths: [...files.keys()],
    middleware: (req, res, next) => {
      const file = req.method === "GET" || req.method === "HEAD" ? files.get(req.path) : undefined;
      if (file === undefined || req.path === "/index.html") {
        next();
        return;
      }
      send(req, res, file, req.path.startsWith("/assets/") ? IMMUTABLE : "no-cache");
    },
    sendIndex: (req, res) => {
      const index = files.get("/index.html");
      if (index === undefined) {
        res.sendFile(path.join(clientDist, "index.html"));
        return;
      }
      // The page names the current hashed files, so it is checked every time.
      send(req, res, index, "no-cache");
    },
  };
}
