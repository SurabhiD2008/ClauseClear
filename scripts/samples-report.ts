// npm run samples:report (prompt 9 evidence, A98): for each file in
// fixtures/samples, its size, flag counts, and the score recomputed two ways
// (the shared computeScore, and the SPEC section 6 formula written out here
// from SCORE_WEIGHTS), compared with the score stored in the file. Also the
// Hindi coverage: keys present, keys left in English, and hiReviewed.
// Exits 1 on any mismatch or invalid file.
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bandForScore,
  computeScore,
  extractTranslatable,
  sampleFileSchema,
  SCORE_MAX,
  SCORE_WEIGHTS,
} from "@clauseclear/shared";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "samples");
const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
const rows: string[][] = [];
let ok = true;
for (const name of names) {
  const path = join(dir, name);
  const bytes = (await stat(path)).size;
  const sample = sampleFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const { flags, score } = sample.en;
  const count = (kind: string, severity: string) =>
    flags.filter((f) => f.kind === kind && f.severity === severity).length;
  const raw =
    SCORE_WEIGHTS.highFlag * count("present", "high") +
    SCORE_WEIGHTS.mediumFlag * count("present", "medium") +
    SCORE_WEIGHTS.highMissing * count("missing", "high") +
    SCORE_WEIGHTS.mediumMissing * count("missing", "medium");
  const byFormula = Math.min(SCORE_MAX, raw);
  const byShared = computeScore(flags).value;
  const match = byFormula === score.value && byShared === score.value;
  const bandMatch = bandForScore(byFormula) === score.band;
  const english = extractTranslatable(sample.en);
  const keys = Object.keys(english);
  const leftEnglish = keys.filter((k) => sample.hi[k] === english[k]).length;
  if (!match || !bandMatch) ok = false;
  rows.push([
    name,
    String(bytes),
    String(flags.length),
    `${String(count("present", "high"))}/${String(count("present", "medium"))}`,
    `${String(count("missing", "high"))}/${String(count("missing", "medium"))}`,
    String(score.value),
    String(byFormula),
    String(byShared),
    `${score.band}${bandMatch ? "" : " (MISMATCH)"}`,
    match ? "yes" : "NO",
    `${String(keys.length - leftEnglish)}/${String(keys.length)}`,
    String(sample.hiReviewed),
  ]);
}
const headers = [
  "File",
  "Bytes",
  "Flags",
  "Present high/med",
  "Missing high/med",
  "Stored score",
  "SPEC formula",
  "computeScore",
  "Band",
  "Match",
  "Hindi differs from English",
  "hiReviewed",
];
console.log(`| ${headers.join(" | ")} |`);
console.log(`| ${headers.map(() => "---").join(" | ")} |`);
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
process.exitCode = ok ? 0 : 1;
