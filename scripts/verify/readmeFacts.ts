// The numbers the README quotes, each written from the value in the code, so a
// change to a limit fails `verify` until the README says the new value. Numbers
// that come from outside the code (a host's limit, a font's name) are listed in
// OUTSIDE_FACTS with their source.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BACKOFF_STEPS_MS,
  BUNDLE_BUDGET_GZIP_BYTES,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_FAILURES,
  DEFAULT_PORT,
  ENV_DEFAULTS,
  IP_WINDOW_MS,
  LIVE_TEST_MAX_CALLS,
  MAX_FILE_MB,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  MIN_TOUCH_TARGET_PX,
  SCORE_BAND_HIGH_FROM,
  SCORE_BAND_MEDIUM_FROM,
  SCORE_MAX,
  SCORE_WEIGHTS,
} from "../../shared/src/constants.js";
import { CONFIG_VARIABLES } from "../../server/src/configSchema.js";
import { COVERAGE_THRESHOLD } from "../../vitest.thresholds.js";

export interface Fact {
  text: string;
  source: string;
}

const n = (value: number) => value.toLocaleString("en-US");
const s = (ms: number) => String(ms / 1000);

function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

/** Upload, text, call and size limits. */
function limitFacts(): Fact[] {
  return [
    {
      text: `${n(MAX_FILE_MB)} MB and ${n(MAX_PDF_PAGES)} pages`,
      source: "MAX_FILE_MB, MAX_PDF_PAGES",
    },
    {
      text: `${n(MIN_TEXT_CHARS)} to ${n(MAX_TEXT_CHARS)} characters`,
      source: "MIN_TEXT_CHARS, MAX_TEXT_CHARS",
    },
    { text: `${n(MAX_FILE_MB)} MB`, source: "MAX_FILE_MB" },
    { text: `at most ${n(LIVE_TEST_MAX_CALLS)} calls`, source: "LIVE_TEST_MAX_CALLS" },
    {
      text: `${String(BUNDLE_BUDGET_GZIP_BYTES / 1000)} KB or less`,
      source: "BUNDLE_BUDGET_GZIP_BYTES",
    },
    { text: `${String(MIN_TOUCH_TARGET_PX)} px is not required`, source: "MIN_TOUCH_TARGET_PX" },
  ];
}

/** The scoring formula and bands. */
function scoringFacts(): Fact[] {
  return [
    { text: `out of ${n(SCORE_MAX)}`, source: "SCORE_MAX" },
    {
      text: `${n(SCORE_WEIGHTS.highFlag)} points per high-risk flag, ${n(SCORE_WEIGHTS.mediumFlag)} per medium, ${n(SCORE_WEIGHTS.highMissing)} per missing high-risk item and ${n(SCORE_WEIGHTS.mediumMissing)} per missing medium item, capped at ${n(SCORE_MAX)}`,
      source: "SCORE_WEIGHTS, SCORE_MAX",
    },
    {
      text: `Below ${n(SCORE_BAND_MEDIUM_FROM)} is low, ${n(SCORE_BAND_HIGH_FROM)} and above is high`,
      source: "SCORE_BAND_MEDIUM_FROM, SCORE_BAND_HIGH_FROM",
    },
  ];
}

/** Router, rate-limit and configuration defaults. */
function runtimeFacts(): Fact[] {
  const example = (name: string) => CONFIG_VARIABLES.find((v) => v.name === name)?.example ?? "";
  return [
    {
      text: `at most ${n(ENV_DEFAULTS.LLM_CONCURRENCY)} AI calls`,
      source: "LLM_CONCURRENCY default",
    },
    {
      text: `back off ${BACKOFF_STEPS_MS.slice(0, -1).map(s).join(", ")} and ${s(BACKOFF_STEPS_MS.at(-1) ?? 0)} seconds`,
      source: "BACKOFF_STEPS_MS",
    },
    {
      text: `fails ${n(CIRCUIT_BREAKER_FAILURES)} times in a row is paused for ${s(CIRCUIT_BREAKER_COOLDOWN_MS)} seconds`,
      source: "CIRCUIT_BREAKER_FAILURES, CIRCUIT_BREAKER_COOLDOWN_MS",
    },
    {
      text: `${n(ENV_DEFAULTS.IP_ANALYSES_PER_10_MIN)} analyses per ${String(IP_WINDOW_MS / 60_000)} minutes`,
      source: "IP_ANALYSES_PER_10_MIN default, IP_WINDOW_MS",
    },
    {
      text: `${n(ENV_DEFAULTS.GLOBAL_ANALYSES_PER_DAY)} analyses and ${n(ENV_DEFAULTS.GLOBAL_TRANSLATIONS_PER_DAY)} Hindi translations per day`,
      source: "GLOBAL_ANALYSES_PER_DAY and GLOBAL_TRANSLATIONS_PER_DAY defaults",
    },
    { text: `on port ${String(DEFAULT_PORT)}`, source: "DEFAULT_PORT" },
    {
      text: `suggests \`${example("GEMINI_THINKING_LEVEL")}\` for \`GEMINI_THINKING_LEVEL\` and \`${example("NVIDIA_MAX_OUTPUT_TOKENS")}\``,
      source: "configuration schema examples",
    },
  ];
}

/** Facts read from repository files: Node version, host limits, test widths, eval size. */
function repoFacts(root: string): Fact[] {
  const vercel = JSON.parse(read(root, "vercel.json")) as {
    functions: Record<string, { maxDuration: number }>;
  };
  const maxDuration = vercel.functions["api/index.js"]?.maxDuration ?? 0;
  const smallest = Math.min(
    ...[...read(root, "playwright.config.ts").matchAll(/width: (\d+)/g)].map((m) => Number(m[1])),
  );
  const cases = (JSON.parse(read(root, "eval/cases.json")) as unknown[]).length;
  const smokeMs = Number(
    (
      /get\("\/api\/health", \{\}, ([\d_]+)\)/.exec(read(root, "scripts/smoke.ts"))?.[1] ?? "0"
    ).replace(/_/g, ""),
  );
  const nodeVersion = read(root, ".node-version").trim();
  const nodeMajor = nodeVersion.split(".")[0] ?? "";
  return [
    { text: `down to ${String(smallest)} px wide`, source: "smallest Playwright viewport" },
    { text: `Node ${nodeMajor} (\`.node-version\` pins ${nodeVersion})`, source: ".node-version" },
    { text: `${nodeMajor}.x`, source: ".node-version major" },
    { text: `**Node ${nodeMajor}.**`, source: ".node-version major" },
    {
      text: `up to ${String(maxDuration)} seconds (an analysis is capped at ${s(ENV_DEFAULTS.ANALYSIS_BUDGET_MS)})`,
      source: "vercel.json maxDuration, ANALYSIS_BUDGET_MS",
    },
    {
      text: `up to ${s(smokeMs)} seconds (a sleeping host`,
      source: "smoke first-request timeout",
    },
    { text: `has ${String(cases)} cases`, source: "eval/cases.json" },
    { text: `under ${String(COVERAGE_THRESHOLD)}%`, source: "coverage threshold" },
  ];
}

export function readmeFacts(root: string): Fact[] {
  return [...limitFacts(), ...scoringFacts(), ...runtimeFacts(), ...repoFacts(root)];
}

/** Numbers that come from outside this code base, with where they come from. */
export const OUTSIDE_FACTS: Fact[] = [
  { text: "4.5 MB", source: "Vercel's request body limit for functions" },
  { text: "Gemini 3 and later", source: "Google's model generations" },
  { text: "Gemini 2.x", source: "Google's model generations" },
  { text: "Source Serif 4", source: "font name" },
  { text: "`s12`", source: "an example clause address" },
  { text: "500 ms of input", source: "Chrome's layout-shift definition (hadRecentInput)" },
  { text: "set to `1`", source: "Vercel adds one proxy hop" },
  { text: "(`1` on Vercel and Render)", source: "Vercel and Render add one proxy hop" },
];
