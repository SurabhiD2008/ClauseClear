// Test data shared by the end-to-end specs: paths, the bundled rental sample
// and a short English lease to paste.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AnalysisResult } from "../../../shared/src/schemas.js";

export const ROOT = process.cwd();
export const DOCS = path.join(ROOT, "fixtures", "docs");
export const DEVANAGARI = /[ऀ-ॿ]/;

export const rental = (
  JSON.parse(readFileSync(path.join(ROOT, "fixtures/samples/rental.json"), "utf8")) as {
    en: AnalysisResult;
  }
).en;

export const LEASE = [
  "LEAVE AND LICENSE AGREEMENT FOR A FLAT IN PUNE",
  "",
  "1. The licensee shall pay a monthly licence fee of Rs. 25,000 on the fifth day of each month.",
  "",
  "2. The licensor may enter the premises at any time without notice to inspect them.",
  "",
  "3. If the licensee leaves before the lock-in ends, the licensee shall forfeit the whole deposit.",
].join("\n");
