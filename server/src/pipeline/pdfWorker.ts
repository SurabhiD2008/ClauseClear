// pdfjs runs in a worker thread, one per PDF (prompt 19, A175). In the main
// thread its decoding is synchronous for long stretches: a 1 MB upload that
// inflates to 1 GB held the event loop for 39 s, so the 20 s cap (SPEC section
// 11) could not fire and every other request waited. A worker can be
// terminated mid-decode, so the cap and a client disconnect now stop it, and
// the server keeps answering meanwhile. At most PDF_PARSE_CONCURRENCY run at
// once, which bounds the memory a burst of such files can take.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  MAX_PDF_PAGES,
  PDF_PARSE_CONCURRENCY,
  PDF_RAW_CHARS_LIMIT,
  PDF_PARSE_TIMEOUT_MS,
  PDF_WORKER_HEAP_MB,
} from "@clauseclear/shared";
import { PipelineError } from "./errors.js";

/** A text item as pdfjs returns it; fields are checked again by the caller. */
export interface RawTextItem {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface RawPage {
  width: number;
  height: number;
  items: RawTextItem[];
}

export interface ParseOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Resolved here, so the worker needs no module resolution of its own (tsx, dist and Vitest alike). */
const PDFJS_URL = pathToFileURL(
  createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs"),
).href;

// Plain JavaScript, run with { eval: true }. XFA, font loading and system
// fonts stay off, as before (A61). Only page sizes and text items come back.
// The worker loads pdfjs as soon as it starts, then reads exactly one job: a
// spare is started ahead, so an upload does not wait for the import.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const pdfjs = import(workerData.pdfjsUrl);
parentPort.once("message", (job) => (async () => {
  const { getDocument } = await pdfjs;
  const task = getDocument({
    data: job.bytes,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  // Owner-password PDFs open without a password but are still encrypted.
  const meta = await doc.getMetadata().catch(() => undefined);
  const filter = meta && meta.info ? meta.info.EncryptFilterName : undefined;
  if (filter !== undefined && filter !== null) return parentPort.postMessage({ code: "PDF_ENCRYPTED" });
  if (doc.numPages > workerData.maxPages) return parentPort.postMessage({ code: "TOO_MANY_PAGES" });
  const pages = [];
  let chars = 0;
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    pages.push({
      width: page.view[2] || 0,
      height: page.view[3] || 0,
      items: content.items.map((i) => ({ str: i.str, transform: i.transform, width: i.width, height: i.height })),
    });
    page.cleanup();
    for (const item of content.items) chars += typeof item.str === "string" ? item.str.replace(/\\s+/g, "").length : 0;
    if (chars > workerData.maxChars) return parentPort.postMessage({ code: "TEXT_TOO_LONG" });
  }
  parentPort.postMessage({ pages });
})().catch((error) => parentPort.postMessage({ errorName: (error && error.name) || "" })));
`;

type WorkerReply =
  | { pages: RawPage[] }
  | { code: "PDF_ENCRYPTED" | "TOO_MANY_PAGES" | "TEXT_TOO_LONG" }
  | { errorName: string };

/** What pdfjs threw, as the answer the user gets. */
export function classifyPdfError(name: string): PipelineError {
  if (name === "PasswordException") return new PipelineError("PDF_ENCRYPTED");
  if (name === "InvalidPDFException")
    return new PipelineError("NOT_PDF", "unreadable PDF structure");
  // Anything else pdfjs throws means the file cannot be read as a PDF.
  return new PipelineError("NOT_PDF", name === "" ? "unreadable PDF" : name);
}

// --- One warm spare ---

let spare: Worker | undefined;

function spawn(): Worker {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { pdfjsUrl: PDFJS_URL, maxPages: MAX_PDF_PAGES, maxChars: PDF_RAW_CHARS_LIMIT },
    resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_HEAP_MB },
  });
  // An idle spare never keeps the process alive.
  worker.unref();
  const forget = () => {
    if (spare === worker) spare = undefined;
  };
  worker.on("error", forget);
  worker.on("exit", forget);
  return worker;
}

/** Starts the spare worker ahead of the first upload (index.ts, at startup). */
export function warmPdfWorker(): void {
  spare ??= spawn();
}

/** The spare if there is one, else a new worker; a new spare starts for the next upload. */
function takeWorker(): Worker {
  const worker = spare ?? spawn();
  spare = spawn();
  worker.ref();
  return worker;
}

// --- At most PDF_PARSE_CONCURRENCY workers at once ---

let running = 0;
const waiting: (() => void)[] = [];

/** Waits for a free slot; an abort while waiting gives up the place in line. */
function acquire(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (running < PDF_PARSE_CONCURRENCY) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const grant = () => {
      signal?.removeEventListener("abort", onAbort);
      running += 1;
      resolve();
    };
    const onAbort = () => {
      const index = waiting.indexOf(grant);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal?.reason as Error);
    };
    waiting.push(grant);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function release(): void {
  running -= 1;
  waiting.shift()?.();
}

/** Workers running or waiting now (tests). */
export function pdfParseLoad(): { running: number; waiting: number } {
  return { running, waiting: waiting.length };
}

/**
 * Parses a PDF in a worker and returns each page's size and text items.
 * Rejects with PipelineError (NOT_PDF, PDF_ENCRYPTED, TOO_MANY_PAGES, TEXT_TOO_LONG, or
 * ANALYSIS_FAILED when the time cap passes) or with the signal's reason.
 * The time cap counts from when the worker starts, not from the wait.
 */
export async function parsePdfInWorker(
  bytes: Uint8Array,
  options: ParseOptions = {},
): Promise<RawPage[]> {
  const { signal } = options;
  const timeoutMs = options.timeoutMs ?? PDF_PARSE_TIMEOUT_MS;
  await acquire(signal);
  try {
    // The abort may have come while this waited, or between the slot and now.
    signal?.throwIfAborted();
    // A copy is transferred, so the caller's buffer stays usable.
    const copy = new Uint8Array(bytes);
    const worker = takeWorker();
    worker.postMessage({ bytes: copy }, [copy.buffer]);
    return await new Promise<RawPage[]>((resolve, reject) => {
      let settled = false;
      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        void worker.terminate();
        outcome();
      };
      const timer = setTimeout(() => {
        finish(() => {
          reject(
            new PipelineError("ANALYSIS_FAILED", `PDF parsing took over ${String(timeoutMs)} ms`),
          );
        });
      }, timeoutMs);
      const onAbort = () => {
        finish(() => {
          reject(signal?.reason as Error);
        });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.on("message", (reply: WorkerReply) => {
        finish(() => {
          if ("pages" in reply) resolve(reply.pages);
          else if ("code" in reply) reject(new PipelineError(reply.code));
          else reject(classifyPdfError(reply.errorName));
        });
      });
      worker.on("error", (error: Error & { code?: unknown }) => {
        finish(() => {
          reject(
            error.code === "ERR_WORKER_OUT_OF_MEMORY"
              ? new PipelineError("NOT_PDF", "PDF needs too much memory to read")
              : new PipelineError("ANALYSIS_FAILED", "PDF worker failed"),
          );
        });
      });
      worker.on("exit", () => {
        finish(() => {
          reject(new PipelineError("ANALYSIS_FAILED", "PDF worker stopped without an answer"));
        });
      });
    });
  } finally {
    release();
  }
}
