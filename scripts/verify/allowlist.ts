// verify.allowlist.json: the committed list of accepted exceptions to the
// forbidden-pattern scan. Each entry names one file, one rule and the exact
// trimmed line (or null for a whole-file rule), with a plain-language reason.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Finding {
  rule: string;
  file: string;
  /** The trimmed line that matched, or null for rules about the whole file. */
  line: string | null;
  detail: string;
}

export interface AllowEntry {
  rule: string;
  file: string;
  line: string | null;
  reason: string;
}

export const ALLOWLIST_FILE = "verify.allowlist.json";

export function loadAllowlist(root: string): AllowEntry[] {
  const file = path.join(root, ALLOWLIST_FILE);
  if (!existsSync(file)) return [];
  const entries = JSON.parse(readFileSync(file, "utf8")) as AllowEntry[];
  for (const e of entries) {
    if (typeof e.reason !== "string" || e.reason.trim().length < 10)
      throw new Error(`${ALLOWLIST_FILE}: entry for ${e.file} (${e.rule}) needs a reason`);
  }
  return entries;
}

export function isAllowed(entries: AllowEntry[], finding: Finding): boolean {
  return entries.some(
    (e) => e.rule === finding.rule && e.file === finding.file && e.line === finding.line,
  );
}

/** Entries that no longer match anything: stale exceptions fail the gate too. */
export function unusedEntries(entries: AllowEntry[], all: Finding[]): AllowEntry[] {
  return entries.filter((e) => !all.some((f) => isAllowed([e], f)));
}
