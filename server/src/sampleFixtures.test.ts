import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Prompt 18, audit item 7: the bundled samples' Hindi must never fuse a Latin
// word to a Devanagari one ("रखनाallowed"), which the oddity guard reports as
// mixed script on screen. Same pattern as the guard (client/e2e/guard.ts).
const MIXED = /[A-Za-z][ऀ-ॣ०-ॿ]|[ऀ-ॣ०-ॿ][A-Za-z]/;
const dir = fileURLToPath(new URL("../../fixtures/samples", import.meta.url));

function strings(node: unknown, at: string, out: [string, string][]) {
  if (typeof node === "string") out.push([at, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => strings(v, `${at}[${String(i)}]`, out));
  else if (typeof node === "object" && node !== null)
    for (const [k, v] of Object.entries(node)) strings(v, `${at}.${k}`, out);
  return out;
}

describe("sample fixtures", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("has the three samples", () => {
    expect(files.sort()).toEqual(["job-offer.json", "loan.json", "rental.json"]);
  });

  it.each(files)("%s: no Hindi string mixes Latin and Devanagari in one word", (file) => {
    const sample = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { hi: unknown };
    const mixed = strings(sample.hi, "hi", []).filter(([, text]) => MIXED.test(text));
    expect(mixed.map(([at]) => at)).toEqual([]);
  });
});
