// SPEC section 6 steps 1 and 2: intake checks and text extraction. Everything
// stays in memory. pdfjs runs in a worker thread with XFA, font loading and
// system fonts off (pdfWorker.ts, A61, A175); it has no eval path left to
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
import { parsePdfInWorker, type RawTextItem } from "./pdfWorker.js";

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

// --- Layout reconstruction ---

/** A positioned run of text from pdfjs, in PDF units (origin bottom-left). */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Line {
  text: string;
  x: number;
  y: number;
  right: number;
  height: number;
  /** 0 for full width or the left column, 1 for the right column. */
  column: number;
}

/** Share of the page height at the top and bottom treated as header and footer bands. */
const EDGE_BAND = 0.08;
/** A gap this much larger than the usual line spacing starts a new paragraph. */
const PARAGRAPH_GAP_RATIO = 1.35;
/** The narrowest empty vertical strip that counts as a column gutter, in PDF units. */
const MIN_GUTTER = 10;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Finds a vertical gutter in the middle 40% of the page that no body run
 * crosses, with text on both sides. Returns its x, or undefined for one column.
 */
export function findGutter(runs: TextRun[], pageWidth: number): number | undefined {
  if (runs.length < 6) return undefined;
  const from = pageWidth * 0.3;
  const to = pageWidth * 0.7;
  const step = 2;
  let best: { start: number; end: number } | undefined;
  let start: number | undefined;
  for (let x = from; x <= to; x += step) {
    const crossed = runs.some((r) => r.x < x && r.x + r.width > x);
    if (!crossed && start === undefined) start = x;
    if ((crossed || x + step > to) && start !== undefined) {
      const end = crossed ? x : to;
      if (best === undefined || end - start > best.end - best.start) best = { start, end };
      start = undefined;
    }
  }
  if (best === undefined || best.end - best.start < MIN_GUTTER) return undefined;
  const gutter = (best.start + best.end) / 2;
  const left = runs.filter((r) => r.x + r.width <= gutter).length;
  const right = runs.filter((r) => r.x >= gutter).length;
  // Both sides need real text; a ragged right margin is not a second column.
  return left >= 3 && right >= 3 ? gutter : undefined;
}

/** Groups runs that share a baseline into lines, left to right. */
function buildLines(runs: TextRun[], column: number): Line[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { runs: TextRun[]; y: number }[] = [];
  for (const run of sorted) {
    const tolerance = Math.max(2, run.height * 0.4);
    const line = lines.find((l) => Math.abs(l.y - run.y) <= tolerance);
    if (line === undefined) lines.push({ runs: [run], y: run.y });
    else line.runs.push(run);
  }
  return lines
    .map((line) => {
      const ordered = line.runs.sort((a, b) => a.x - b.x);
      let text = "";
      let right = Number.NEGATIVE_INFINITY;
      for (const run of ordered) {
        // pdfjs gives no space between runs that are visually apart.
        const gap = run.x - right;
        if (text !== "" && gap > run.height * 0.15 && !/\s$/.test(text) && !/^\s/.test(run.text)) {
          text += " ";
        }
        text += run.text;
        right = Math.max(right, run.x + run.width);
      }
      const first = ordered[0];
      return {
        text: text.trim(),
        x: first?.x ?? 0,
        y: line.y,
        right,
        height: Math.max(...ordered.map((r) => r.height)),
        column,
      };
    })
    .filter((line) => line.text !== "")
    .sort((a, b) => b.y - a.y);
}

/** Lines of one page in reading order: header band, left column, right column, footer band. */
export function pageLines(runs: TextRun[], pageWidth: number, pageHeight: number): Line[] {
  const top = pageHeight * (1 - EDGE_BAND);
  const bottom = pageHeight * EDGE_BAND;
  const header = runs.filter((r) => r.y >= top);
  const footer = runs.filter((r) => r.y <= bottom);
  const body = runs.filter((r) => r.y < top && r.y > bottom);
  const gutter = findGutter(body, pageWidth);
  const columns =
    gutter === undefined
      ? buildLines(body, 0)
      : [
          ...buildLines(
            body.filter((r) => r.x + r.width / 2 < gutter),
            0,
          ),
          ...buildLines(
            body.filter((r) => r.x + r.width / 2 >= gutter),
            1,
          ),
        ];
  return [...buildLines(header, 0), ...columns, ...buildLines(footer, 0)];
}

/**
 * The line spacing inside a paragraph: the smallest spacing that occurs at least
 * twice (to the nearest unit), ignoring gaps under 0.8 of a line height. The
 * median is wrong on pages of short one- or two-line clauses, where paragraph
 * gaps outnumber line gaps. Falls back to the median.
 */
function usualSpacing(gaps: number[], lineHeight: number): number {
  const counts = new Map<number, number>();
  for (const gap of gaps) {
    if (gap < lineHeight * 0.8) continue;
    const key = Math.round(gap);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = [...counts].filter(([, n]) => n >= 2).map(([gap]) => gap);
  return repeated.length > 0 ? Math.min(...repeated) : median(gaps);
}

/** Lines become paragraphs at vertical gaps and column changes; lines inside one keep their breaks. */
export function linesToParagraphs(lines: Line[]): string[] {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1];
    const line = lines[i];
    if (prev !== undefined && prev.column === line?.column) {
      const gap = prev.y - line.y;
      if (gap > 0) gaps.push(gap);
    }
  }
  const usual = usualSpacing(gaps, median(lines.map((l) => l.height)));
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const prev = lines[i - 1];
    const breakHere =
      prev !== undefined &&
      (prev.column !== line.column || usual === 0 || prev.y - line.y > usual * PARAGRAPH_GAP_RATIO);
    if (breakHere && current.length > 0) {
      paragraphs.push(current);
      current = [];
    }
    current.push(line.text);
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs.map((p) => p.join("\n"));
}

/** Digits stand in for page numbers, so "Page 2 of 5" and "Page 3 of 5" match. */
function edgeKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/**
 * Removes running headers and footers: lines among the first or last two of a
 * page whose text (digits ignored) repeats on at least half the pages, and on
 * at least two.
 */
export function removeRepeatedEdges(pages: Line[][]): Line[][] {
  if (pages.length < 2) return pages;
  const edges = (lines: Line[]) => [...lines.slice(0, 2), ...lines.slice(-2)];
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const key of new Set(edges(lines).map((l) => edgeKey(l.text)))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const needed = Math.max(2, Math.ceil(pages.length / 2));
  const repeated = new Set([...counts].filter(([, n]) => n >= needed).map(([key]) => key));
  return pages.map((lines) => {
    const edgeLines = new Set(edges(lines));
    return lines.filter((line) => !(edgeLines.has(line) && repeated.has(edgeKey(line.text))));
  });
}

// --- PDF loading ---

function toRun(item: RawTextItem): TextRun | undefined {
  if (typeof item.str !== "string" || !Array.isArray(item.transform)) return undefined;
  const [, , , scaleY, x, y] = item.transform as number[];
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  const height =
    typeof item.height === "number" && item.height > 0 ? item.height : Math.abs(scaleY ?? 0);
  return {
    text: item.str,
    x,
    y,
    width: typeof item.width === "number" ? item.width : 0,
    height,
  };
}

/** Checks size and magic bytes before any parsing (SPEC section 6 step 1). */
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
  // pdfjs runs in a worker that the time cap and an abort can stop (A175).
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
  // A11: input must be English, and Devanagari must never reach the viewer before the toggle.
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
  // Under NO_TEXT_MIN_CHARS of text means a scan or an empty text layer (step 2).
  return finish(pages, raw.length, "NO_TEXT");
}

/** Pasted text: one page, the same normalisation and limits. */
export function readPastedText(text: string): DocumentText {
  return finish([{ page: 1, text: normalizeText(text) }], 1, "TEXT_TOO_SHORT");
}
