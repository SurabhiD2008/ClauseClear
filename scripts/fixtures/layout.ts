// A small text layout engine on pdf-lib for the test fixtures. It draws one
// text run per line, the way word processors export, with a running header
// and a "Page n of N" footer on every page, so extraction has real layout to
// rebuild. Metadata dates are fixed, so the same input always gives the same bytes.
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage, rgb } from "pdf-lib";

export type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "item"; text: string }
  /** Lines drawn exactly as given, one per "\n" (for hyphenation fixtures). */
  | { kind: "raw"; text: string };

export interface DocumentSpec {
  title: string;
  /** Running header on every page; omitted when undefined. */
  header?: string;
  /** Add "Page n of N" at the bottom of every page. */
  pageNumbers?: boolean;
  columns?: 1 | 2;
  blocks: Block[];
}

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
const MARGIN = 72;
const SIZE = 12;
const LEADING = 17;
const PARAGRAPH_GAP = 9;
const TITLE_SIZE = 16;
const ITEM_INDENT = 20;
const COLUMN_GAP = 28;
export const FIXED_DATE = new Date("2026-11-01T00:00:00Z");

const SOFT_HYPHEN = "\u00AD";

/** Wraps text to a width, breaking long words at soft hyphens when they would not fit. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  const lines: string[] = [];
  let line = "";
  const fits = (candidate: string) => font.widthOfTextAtSize(candidate, size) <= width;
  for (const word of words) {
    const clean = word.replaceAll(SOFT_HYPHEN, "");
    const candidate = line === "" ? clean : `${line} ${clean}`;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    // Try the longest soft-hyphen split whose first half still fits on this line.
    const parts = word.split(SOFT_HYPHEN);
    let placed = false;
    for (let cut = parts.length - 1; cut > 0 && line !== ""; cut -= 1) {
      const head = `${line} ${parts.slice(0, cut).join("")}-`;
      if (fits(head)) {
        lines.push(head);
        line = parts.slice(cut).join("");
        placed = true;
        break;
      }
    }
    if (placed) continue;
    if (line !== "") lines.push(line);
    line = clean;
  }
  if (line !== "") lines.push(line);
  return lines;
}

export async function newDocument(title: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("ClauseClear test fixtures");
  doc.setCreator("scripts/build-fixtures.ts");
  doc.setProducer("pdf-lib");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

export async function renderDocument(spec: DocumentSpec): Promise<PDFDocument> {
  const doc = await newDocument(spec.title);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const columns = spec.columns ?? 1;
  const columnWidth = (PAGE_WIDTH - 2 * MARGIN - (columns - 1) * COLUMN_GAP) / columns;
  const top = PAGE_HEIGHT - MARGIN;
  const bottom = MARGIN + 10;

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let column = 0;
  let y = top;

  const nextColumn = () => {
    if (column + 1 < columns) {
      column += 1;
    } else {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      column = 0;
    }
    y = top;
  };
  const left = () => MARGIN + column * (columnWidth + COLUMN_GAP);
  const drawLine = (text: string, font: PDFFont, size: number, indent = 0, centre = false) => {
    if (y - LEADING < bottom) nextColumn();
    const x = centre ? (PAGE_WIDTH - font.widthOfTextAtSize(text, size)) / 2 : left() + indent;
    page.drawText(text, { x, y: y - size, size, font, color: rgb(0, 0, 0) });
    y -= LEADING;
  };

  for (const block of spec.blocks) {
    // No gap above the first block of a page or column.
    if (y < top) y -= PARAGRAPH_GAP;
    switch (block.kind) {
      case "title":
        for (const line of wrap(block.text, bold, TITLE_SIZE, columnWidth)) {
          drawLine(line, bold, TITLE_SIZE, 0, columns === 1);
        }
        y -= 6;
        break;
      case "heading":
        // Keep a heading with at least two lines of what follows.
        if (y - 3 * LEADING < bottom) nextColumn();
        for (const line of wrap(block.text, bold, SIZE, columnWidth)) drawLine(line, bold, SIZE);
        break;
      case "para":
        for (const line of wrap(block.text, regular, SIZE, columnWidth))
          drawLine(line, regular, SIZE);
        break;
      case "item":
        for (const line of wrap(block.text, regular, SIZE, columnWidth - ITEM_INDENT)) {
          drawLine(line, regular, SIZE, ITEM_INDENT);
        }
        break;
      case "raw":
        for (const line of block.text.split("\n")) drawLine(line, regular, SIZE);
        break;
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, index) => {
    if (spec.header !== undefined) {
      const width = regular.widthOfTextAtSize(spec.header, 9);
      p.drawText(spec.header, {
        x: (PAGE_WIDTH - width) / 2,
        y: PAGE_HEIGHT - 40,
        size: 9,
        font: regular,
      });
    }
    if (spec.pageNumbers === true) {
      const label = `Page ${String(index + 1)} of ${String(pages.length)}`;
      const width = regular.widthOfTextAtSize(label, 9);
      p.drawText(label, { x: (PAGE_WIDTH - width) / 2, y: 36, size: 9, font: regular });
    }
  });
  return doc;
}

/** Saves without object streams so the file layout is simple and stable. */
export function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: false });
}

export const h = (text: string): Block => ({ kind: "heading", text });
export const p = (text: string): Block => ({ kind: "para", text });
export const i = (text: string): Block => ({ kind: "item", text });
export const title = (text: string): Block => ({ kind: "title", text });
export const raw = (text: string): Block => ({ kind: "raw", text });
