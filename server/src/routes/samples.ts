// GET /api/samples and GET /api/samples/:id (SPEC section 7, F14). Served from
// fixture files with zero API calls. Every file is checked against the shared
// schema when the app is built, so the server refuses to start on a broken
// sample instead of serving it (A98).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import {
  errorBody,
  sampleFileSchema,
  type SampleResponse,
  type SampleSummary,
} from "@clauseclear/shared";
import express from "express";
import { pickEncoding } from "../staticAssets.js";
import { sendError } from "./errors.js";

export interface SampleStore {
  list: SampleSummary[];
  byId: Map<string, SampleResponse>;
}

/** Reads every *.json in dir, in name order. Throws on any invalid file, or none at all. */
export function loadSamples(dir: string): SampleStore {
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort();
  if (names.length === 0) throw new Error(`no sample files in ${dir}`);
  const list: SampleSummary[] = [];
  const byId = new Map<string, SampleResponse>();
  for (const name of names) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    } catch {
      throw new Error(`sample ${name} is not valid JSON`);
    }
    const parsed = sampleFileSchema.safeParse(json);
    if (!parsed.success) {
      const where = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")} (${i.message})`)
        .join(", ");
      throw new Error(`sample ${name} is invalid at ${where}`);
    }
    const { id, title, docType, en, hi } = parsed.data;
    if (byId.has(id)) throw new Error(`sample id ${id} is repeated`);
    list.push({ id, title, docType });
    byId.set(id, { en, hi });
  }
  return { list, byId };
}

export function samplesRouter(dir: string): express.Router {
  const store = loadSamples(dir);
  const router = express.Router();

  router.get("/samples", (_req, res) => {
    res.json(store.list);
  });
  // Each sample body (about 42 KB) is serialised and compressed once (prompt 19, A179).
  const bodies = new Map(
    [...store.byId].map(([id, sample]) => {
      const raw = Buffer.from(JSON.stringify(sample));
      return [id, { raw, br: brotliCompressSync(raw), gzip: gzipSync(raw) }] as const;
    }),
  );
  router.get("/samples/:id", (req, res) => {
    const body = bodies.get(req.params.id);
    if (body === undefined) {
      sendError(res, errorBody("NOT_FOUND"));
      return;
    }
    const encoding = pickEncoding(req.headers["accept-encoding"]);
    const bytes = encoding === undefined ? body.raw : body[encoding];
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (encoding !== undefined) res.setHeader("Content-Encoding", encoding);
    res.setHeader("Content-Length", String(bytes.byteLength));
    res.status(200).end(bytes);
  });
  return router;
}
