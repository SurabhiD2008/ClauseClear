// Prints pages, characters, segments and estimated tokens for the four main
// fixtures, computed by the real intake pipeline (never typed by hand).
//   npm run fixtures:stats
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "@clauseclear/shared";
import { chunkSegments, documentTokens } from "../server/src/pipeline/chunk.js";
import { readPdf } from "../server/src/pipeline/extract.js";
import { segmentDocument } from "../server/src/pipeline/segment.js";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "docs");
const names = ["rental.pdf", "employment.pdf", "loan.pdf", "terms.pdf"];

const header = [
  "Fixture",
  "Pages",
  "Characters",
  "Segments",
  "Est. tokens (text)",
  "Est. tokens (prompt)",
  "Chunks",
];
const rows: string[][] = [];
for (const name of names) {
  const doc = await readPdf(new Uint8Array(await readFile(join(docs, name))));
  const segments = segmentDocument(doc.pages);
  rows.push([
    name,
    String(doc.pageCount),
    String(doc.text.length),
    String(segments.length),
    String(estimateTokens(doc.text)),
    String(documentTokens(segments)),
    String(chunkSegments(segments).length),
  ]);
}

const widths = header.map((title, column) =>
  Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0)),
);
const format = (cells: string[]) =>
  `| ${cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0))).join(" | ")} |`;
console.log(format(header));
console.log(
  `| ${widths.map((width, column) => (column === 0 ? "-".repeat(width) : `${"-".repeat(width - 1)}:`)).join(" | ")} |`,
);
for (const row of rows) console.log(format(row));
console.log(
  "\nText tokens = characters / 4, rounded up. Prompt tokens count the segments as the model sees them ([s12] text, one per line).",
);
