// The PDF worker (prompt 19, A175): a decompression bomb is stopped by the time
// cap without blocking the server, at most PDF_PARSE_CONCURRENCY parse at once,
// and an abort while waiting gives up the place in line.
import { deflateSync } from "node:zlib";
import { PDF_PARSE_CONCURRENCY, PDF_RAW_CHARS_LIMIT } from "@clauseclear/shared";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PipelineError } from "./errors.js";
import { parsePdfInWorker, pdfParseLoad } from "./pdfWorker.js";

/** One page whose content stream is a little text and then `mb` megabytes of spaces, deflated. */
async function bombPdf(mb: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.setFont(font);
  const fontKey = page.node.normalizedEntries().Font.keys()[0]?.asString() ?? "/F1";
  const ops = `BT ${fontKey} 10 Tf 40 800 Td (The tenant shall pay the rent.) Tj ET\n`;
  const inflated = Buffer.concat([Buffer.from(ops), Buffer.alloc(mb * 1024 * 1024, 0x20)]);
  const stream = doc.context.stream(deflateSync(inflated, { level: 1 }), { Filter: "FlateDecode" });
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  return doc.save({ useObjectStreams: false });
}

async function smallPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText("The tenant shall pay the rent.", { x: 40, y: 800, font });
  return doc.save();
}

async function errorOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("parsePdfInWorker", () => {
  it("returns page sizes and text items", async () => {
    const pages = await parsePdfInWorker(await smallPdf());
    expect(pages).toHaveLength(1);
    expect(pages[0]?.width).toBe(595);
    expect(pages[0]?.items.map((i) => i.str).join("")).toContain("The tenant shall pay the rent.");
  });

  it("stops a decompression bomb at the time cap while the event loop keeps running", async () => {
    const bomb = await bombPdf(400);
    expect(bomb.byteLength).toBeLessThan(5 * 1024 * 1024);
    // Event-loop lag: in the main thread pdfjs held the loop for seconds (prompt 19 probe).
    let worstLag = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      worstLag = Math.max(worstLag, now - last - 20);
      last = now;
    }, 20);
    const started = performance.now();
    const error = await errorOf(parsePdfInWorker(bomb, { timeoutMs: 300 }));
    const elapsed = performance.now() - started;
    clearInterval(ticker);
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).code).toBe("ANALYSIS_FAILED");
    // Loose bounds for a loaded test machine; in the main thread a 400 MB bomb
    // held the loop for seconds (3.5 s at 200 MB, 39 s at 1 GB in the probe).
    expect(elapsed).toBeLessThan(5_000);
    expect(worstLag).toBeLessThan(1_000);
    expect(pdfParseLoad()).toEqual({ running: 0, waiting: 0 });
  }, 30_000);

  it("stops with TEXT_TOO_LONG once the raw text passes PDF_RAW_CHARS_LIMIT", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const line = "x".repeat(400);
    for (let p = 0; p < 6; p += 1) {
      const page = doc.addPage([595, 842]);
      for (let row = 0; row < 40; row += 1) {
        page.drawText(line, { x: 5, y: 830 - row * 20, size: 2, font });
      }
    }
    // 6 pages x 40 rows x 400 = 96,000 characters, over 1.5 x 60,000.
    expect(6 * 40 * 400).toBeGreaterThan(PDF_RAW_CHARS_LIMIT);
    const error = await errorOf(parsePdfInWorker(await doc.save()));
    expect((error as PipelineError).code).toBe("TEXT_TOO_LONG");
  }, 30_000);

  it(`runs at most ${String(PDF_PARSE_CONCURRENCY)} at once; the rest wait their turn`, async () => {
    const bytes = await smallPdf();
    const work = Array.from({ length: PDF_PARSE_CONCURRENCY + 2 }, () => parsePdfInWorker(bytes));
    await Promise.resolve();
    expect(pdfParseLoad()).toEqual({ running: PDF_PARSE_CONCURRENCY, waiting: 2 });
    const pages = await Promise.all(work);
    expect(pages.every((p) => p.length === 1)).toBe(true);
    expect(pdfParseLoad()).toEqual({ running: 0, waiting: 0 });
  }, 30_000);

  it("an abort while waiting leaves the line and never starts a worker", async () => {
    const bytes = await smallPdf();
    const busy = Array.from({ length: PDF_PARSE_CONCURRENCY }, () => parsePdfInWorker(bytes));
    const controller = new AbortController();
    const queued = parsePdfInWorker(bytes, { signal: controller.signal });
    await Promise.resolve();
    expect(pdfParseLoad().waiting).toBe(1);
    controller.abort(new Error("client went away"));
    await expect(queued).rejects.toThrow("client went away");
    expect(pdfParseLoad().waiting).toBe(0);
    await Promise.all(busy);
    expect(pdfParseLoad()).toEqual({ running: 0, waiting: 0 });
  }, 30_000);
});
