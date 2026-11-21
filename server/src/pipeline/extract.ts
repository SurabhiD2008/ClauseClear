// Intake checks and text extraction. Everything
// stays in memory. pdfjs runs in a worker thread with XFA, font loading and
// system fonts off (pdfWorker.ts); it has no eval path left to
// disable in v6 and never runs document scripts outside the viewer's
// annotation layer, which is not used.
import {
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  NO_TEXT_MIN_CHARS,
  PDF_MAGIC,
  DEVANAGARI_PATTERN,
} from "@clauseclear/shared";
import { PipelineError } from "./errors.js";
import { normalizeText } from "./normalize.js";
import {
  linesToParagraphs,
  pageLines,
  removeRepeatedEdges,
  toRun,
  type TextRun,
} from "./pdfLayout.js";
import { parsePdfInWorker } from "./pdfWorker.js";

/** One page of normalised text. Page numbers start at 1. */
export interface PageText {
  page: number;
  text: string;
}

/** The document as the viewer shows it: pages joined by a blank line. */
export interface DocumentText {
  pages: PageText[];
  text: string;
  /** Page count of the source (1 for pasted text). */
  pageCount: number;
}

export interface ExtractOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Checks size and magic bytes before any parsing. */
export function checkPdfBytes(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new PipelineError("BAD_REQUEST", "empty file");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new PipelineError("FILE_TOO_LARGE");
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, PDF_MAGIC.length));
  if (head !== PDF_MAGIC) throw new PipelineError("NOT_PDF", "missing %PDF header");
}

/** Raw page text (before normalisation), with layout rebuilt into paragraphs. */
export async function extractPdfPages(
  bytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<string[]> {
  checkPdfBytes(bytes);
  options.signal?.throwIfAborted();
  // pdfjs runs in a worker that the time cap and an abort can stop.
  const raw = await parsePdfInWorker(bytes, options);
  const pages = raw.map((page) =>
    pageLines(
      page.items
        .map(toRun)
        .filter((run): run is TextRun => run !== undefined && run.text.trim() !== ""),
      page.width,
      page.height,
    ),
  );
  return removeRepeatedEdges(pages).map((lines) => linesToParagraphs(lines).join("\n\n"));
}

// --- Intake: the checks after normalisation ---

function finish(
  pages: PageText[],
  pageCount: number,
  tooShort: "NO_TEXT" | "TEXT_TOO_SHORT",
): DocumentText {
  const kept = pages.filter((p) => p.text !== "");
  const text = kept.map((p) => p.text).join("\n\n");
  const minChars = tooShort === "NO_TEXT" ? NO_TEXT_MIN_CHARS : MIN_TEXT_CHARS;
  if (text.length < minChars) throw new PipelineError(tooShort);
  if (text.length > MAX_TEXT_CHARS) throw new PipelineError("TEXT_TOO_LONG");
  // Input must be English, and Devanagari must never reach the viewer before the toggle.
  if (DEVANAGARI_PATTERN.test(text)) throw new PipelineError("NOT_ENGLISH");
  return { pages: kept, text, pageCount };
}

/** A PDF upload, from bytes to the normalised text the viewer shows. */
export async function readPdf(
  bytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<DocumentText> {
  const raw = await extractPdfPages(bytes, options);
  const pages = raw.map((text, index) => ({ page: index + 1, text: normalizeText(text) }));
  // Under NO_TEXT_MIN_CHARS of text means a scan or an empty text layer.
  return finish(pages, raw.length, "NO_TEXT");
}

/** Pasted text: one page, the same normalisation and limits. */
export function readPastedText(text: string): DocumentText {
  return finish([{ page: 1, text: normalizeText(text) }], 1, "TEXT_TOO_SHORT");
}
