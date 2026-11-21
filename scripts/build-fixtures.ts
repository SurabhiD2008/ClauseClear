// Generates every PDF in fixtures/docs.
//   npm run fixtures
// Output is deterministic: fixed metadata dates, a seeded generator for filler
// bytes, and a fixed document id for the encrypted file. No oversize file is
// written: the tests build their own buffer one byte or KiB over the limit.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFHexString, PDFName, PDFNumber, StandardFonts, rgb } from "pdf-lib";
import { employment } from "./fixtures/employment.js";
import {
  TEXT_RENAMED,
  canary,
  hyphenation,
  injection,
  longParagraph,
  twoColumn,
} from "./fixtures/special.js";
import { general } from "./fixtures/general.js";
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  newDocument,
  p,
  renderDocument,
  save,
  title,
  type DocumentSpec,
} from "./fixtures/layout.js";
import { loan } from "./fixtures/loan.js";
import { rental } from "./fixtures/rental.js";
import { terms } from "./fixtures/terms.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures", "docs");

/** Small seeded generator (mulberry32) so filler bytes are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fromSpec(spec: DocumentSpec): Promise<Uint8Array> {
  return save(await renderDocument(spec));
}

/** Two pages of drawn shapes that look like a scanned page but carry no text layer. */
async function scanNoText(): Promise<Uint8Array> {
  const doc = await newDocument("Scanned agreement");
  const random = seeded(7);
  for (let n = 0; n < 2; n += 1) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: rgb(0.96, 0.95, 0.92),
    });
    // Grey bars where lines of text would be in a scan.
    for (let y = PAGE_HEIGHT - 90; y > 90; y -= 17) {
      const width = 300 + random() * 150;
      page.drawRectangle({ x: 72, y, width, height: 7, color: rgb(0.45, 0.45, 0.45) });
    }
  }
  return save(doc);
}

/**
 * A PDF with a Standard security handler (V1, R2) in its trailer. The /U value
 * is random, so no password, not even the empty one, opens it.
 */
async function encrypted(): Promise<Uint8Array> {
  const doc = await renderDocument({
    title: "Encrypted agreement",
    blocks: [title("ENCRYPTED AGREEMENT"), p("This text cannot be read without the password.")],
  });
  const random = seeded(11);
  const hex = (count: number) =>
    Array.from({ length: count }, () =>
      Math.floor(random() * 256)
        .toString(16)
        .padStart(2, "0"),
    ).join("");
  const encryptDict = doc.context.obj({
    Filter: PDFName.of("Standard"),
    V: PDFNumber.of(1),
    R: PDFNumber.of(2),
    Length: PDFNumber.of(40),
    P: PDFNumber.of(-44),
    O: PDFHexString.of(hex(32)),
    U: PDFHexString.of(hex(32)),
  });
  const id = PDFHexString.of(hex(16));
  doc.context.trailerInfo.Encrypt = doc.context.register(encryptDict);
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);
  return save(doc);
}

async function overPageLimit(): Promise<Uint8Array> {
  // One short schedule per page, so the page count is exact.
  const doc = await newDocument("Annual maintenance contract");
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let n = 1; n <= 26; n += 1) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText(
      `Schedule ${String(n)}: equipment, visit frequency and response time for site ${String(n)}.`,
      {
        x: 72,
        y: PAGE_HEIGHT - 100,
        size: 12,
        font,
      },
    );
  }
  return save(doc);
}

interface FontkitFont {
  layout: (text: string, features?: unknown, script?: string) => unknown;
}

/** Symbols in a standard font plus Devanagari lines in Noto Sans Devanagari. */
async function symbolsDevanagari(): Promise<Uint8Array> {
  const doc = await newDocument("Symbols and Devanagari");
  doc.registerFontkit(fontkit);
  const fontPath = join(
    root,
    "node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff",
  );
  const devanagari = await doc.embedFont(await readFile(fontPath), { subset: true });
  // @pdf-lib/fontkit's Indic shaper needs a global regeneratorRuntime it does not
  // ship. Laying the text out as Latin script skips that shaper: each character
  // maps to its own glyph, so conjuncts are not formed, but the text layer still
  // carries the exact Devanagari code points, which is all the NOT_ENGLISH test reads.
  const shaper = (devanagari as unknown as { embedder: { font: FontkitFont } }).embedder.font;
  const layout = shaper.layout.bind(shaper);
  shaper.layout = (text, features) => layout(text, features, "latn");
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 90;
  const line = (text: string, font = latin) => {
    page.drawText(text, { x: 72, y, size: 12, font });
    y -= 20;
  };
  line("RENT AGREEMENT § 4 • © 2026 ® ™ ¶ † ‡");
  line("Rent: 25,000 per month ± 5% … deposit ½ of annual rent ° € 0");
  line("« clause » “quoted” ‘single’ – dash — long dash");
  line("किराया समझौता", devanagari);
  line("यह समझौता पुणे में किया गया है।", devanagari);
  line("सिक्योरिटी डिपॉजिट दस महीने का किराया है।", devanagari);
  line("नोटिस अवधि तीन महीने है।", devanagari);
  for (let n = 0; n < 8; n += 1) {
    line("The licensee shall pay the rent and the deposit as set out in this agreement.");
  }
  return save(doc);
}

const outputs: [string, () => Promise<Uint8Array>][] = [
  ["rental.pdf", () => fromSpec(rental)],
  ["employment.pdf", () => fromSpec(employment)],
  ["loan.pdf", () => fromSpec(loan)],
  ["terms.pdf", () => fromSpec(terms)],
  ["general-contract.pdf", () => fromSpec(general)],
  ["scan-no-text.pdf", scanNoText],
  ["encrypted.pdf", encrypted],
  ["empty.pdf", () => Promise.resolve(new Uint8Array(0))],
  ["over-25-pages.pdf", overPageLimit],
  ["text-renamed.pdf", () => Promise.resolve(new TextEncoder().encode(TEXT_RENAMED))],
  ["injection.pdf", () => fromSpec(injection)],
  ["log-canary.pdf", () => fromSpec(canary)],
  ["long-paragraph.pdf", () => fromSpec(longParagraph)],
  ["symbols-devanagari.pdf", symbolsDevanagari],
  ["two-column.pdf", () => fromSpec(twoColumn)],
  ["hyphenation.pdf", () => fromSpec(hyphenation)],
];

await mkdir(outDir, { recursive: true });
for (const [name, build] of outputs) {
  const bytes = await build();
  await writeFile(join(outDir, name), bytes);
  console.log(`${name.padEnd(24)} ${String(bytes.length).padStart(9)} bytes`);
}
