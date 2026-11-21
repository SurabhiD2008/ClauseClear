// Shared names for the browser guard: its checks, findings and limits.
import { readFileSync } from "node:fs";
import path from "node:path";

export const GUARD_CHECKS = [
  "console",
  "runtime",
  "network",
  "overflow",
  "clipping",
  "targets",
  "semantics",
  "axe",
  "layout-shift",
  "language",
  "focus",
  "motion",
] as const;
export type GuardCheck = (typeof GUARD_CHECKS)[number];

export interface Violation {
  check: GuardCheck;
  detail: string;
}

export interface Guard {
  /** A response with this status (any 400+ if omitted) for a matching URL is part of the test. */
  expectStatus(url: RegExp, status?: number): void;
  /** Runs every check now and returns the findings without failing (self-tests). */
  collect(): Promise<Violation[]>;
  /** Forgets everything recorded so far (self-tests, after collect). */
  reset(): void;
}

/** CLS above this fails. */
export const CLS_LIMIT = 0.1;
/** Smallest tap target on a phone project, in CSS pixels. */
export const MIN_TARGET = 44;

/** Every interface key, so a key shown instead of its text can be spotted. */
function flatKeys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) =>
    flatKeys(v, prefix === "" ? k : `${prefix}.${k}`),
  );
}
export const I18N_KEYS = flatKeys(
  JSON.parse(readFileSync(path.join(process.cwd(), "client/src/i18n/en.json"), "utf8")) as unknown,
).filter((key) => key.includes("."));

/**
 * The user's own document and the quotes from it: English by rule, and checked
 * by the language rules only as document text, never as interface text (it may
 * hold Devanagari).
 */
export const USER_TEXT = ".cc-doc, .cc-quote__text, .cc-results__name, textarea";
