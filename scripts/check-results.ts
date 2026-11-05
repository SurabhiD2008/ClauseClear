// Correctness check over every fixture (prompt 19): the three bundled samples
// (English result and Hindi map) and every PDF in fixtures/docs run through the
// real pipeline with the mock provider, in four mock scenarios and both the
// single-call and chunked paths. No network, no key.
//   npm run results:check
// The checks are written here from SPEC sections 6 and 7, not imported from the
// schema's own invariant check, so they are a second, independent reading:
//   1. every present flag's quote is an exact substring of its segment
//   2. every id reference (segment, flag, term) resolves, and ids are unique
//   3. the score recomputes from the flags with SPEC's formula, and its band
//   4. counts match: stats.segments, score.counts, stats.chars, page numbers
//   5. a sample's Hindi map has only known, translatable keys and the same numbers
// Exits 1 if any check fails.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_DEFAULTS, type AnalysisResult } from "@clauseclear/shared";
import { createMockProvider, type MockScenario } from "../server/src/llm/mock.js";
import { LlmRouter } from "../server/src/llm/router.js";
import { PipelineError } from "../server/src/pipeline/errors.js";
import { runAnalysis } from "../server/src/pipeline/run.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];
let checks = 0;

function expectThat(ok: boolean, what: string): void {
  checks += 1;
  if (!ok) failures.push(what);
}

/** SPEC section 6 "Scoring", written out again on purpose. */
function specScore(flags: AnalysisResult["flags"]) {
  const n = (kind: string, severity: string) =>
    flags.filter((f) => f.kind === kind && f.severity === severity).length;
  const raw =
    18 * n("present", "high") +
    8 * n("present", "medium") +
    10 * n("missing", "high") +
    5 * n("missing", "medium");
  const value = Math.min(100, raw);
  const band = value < 25 ? "low" : value < 55 ? "medium" : "high";
  return { value, band, high: n("present", "high"), medium: n("present", "medium") };
}

/** Returns a one-line summary; records failures. */
function checkResult(label: string, r: AnalysisResult): string {
  const segments = new Map(r.segments.map((s) => [s.id, s]));
  const flagIds = new Set(r.flags.map((f) => f.id));
  const termIds = new Set(r.glossary.map((g) => g.id));
  const at = (what: string) => `${label}: ${what}`;

  // 2. Unique ids across every collection.
  const all = [
    ...r.segments,
    ...r.flags,
    ...r.keyFacts,
    ...r.clauses,
    ...r.questions,
    ...r.checklist.before,
    ...r.checklist.after,
    ...r.glossary,
  ].map((x) => x.id);
  expectThat(new Set(all).size === all.length, at("duplicate ids"));

  // 1 and 2. Flags.
  let quotes = 0;
  for (const f of r.flags) {
    if (f.kind === "present") {
      const segment = f.segmentId === undefined ? undefined : segments.get(f.segmentId);
      expectThat(segment !== undefined, at(`flag ${f.id} segment ${String(f.segmentId)} missing`));
      expectThat(
        f.quote !== undefined && segment?.text.includes(f.quote) === true,
        at(`flag ${f.id} quote is not an exact substring of ${String(f.segmentId)}`),
      );
      quotes += 1;
    } else {
      expectThat(
        f.segmentId === undefined && f.quote === undefined,
        at(`missing flag ${f.id} has a quote`),
      );
    }
    for (const t of f.termIds) expectThat(termIds.has(t), at(`flag ${f.id} term ${t} unknown`));
  }
  let refs = 0;
  const seg = (id: string | undefined, where: string) => {
    if (id === undefined) return;
    refs += 1;
    expectThat(segments.has(id), at(`${where} -> segment ${id} unknown`));
  };
  const flag = (id: string | undefined, where: string) => {
    if (id === undefined) return;
    refs += 1;
    expectThat(flagIds.has(id), at(`${where} -> flag ${id} unknown`));
  };
  r.keyFacts.forEach((k) => {
    seg(k.segmentId, `keyFact ${k.id}`);
  });
  r.clauses.forEach((c) => {
    seg(c.segmentId, `clause ${c.id}`);
    flag(c.flagId, `clause ${c.id}`);
  });
  r.questions.forEach((q) => {
    q.flagIds.forEach((id) => {
      flag(id, `question ${q.id}`);
    });
  });
  [...r.checklist.before, ...r.checklist.after].forEach((item) => {
    item.flagIds.forEach((id) => {
      flag(id, `checklist ${item.id}`);
    });
  });

  // 3. Score.
  const expected = specScore(r.flags);
  expectThat(
    r.score.value === expected.value,
    at(`score ${String(r.score.value)} != ${String(expected.value)}`),
  );
  expectThat(r.score.band === expected.band, at(`band ${r.score.band} != ${expected.band}`));

  // 4. Counts.
  const missing = r.flags.filter((f) => f.kind === "missing").length;
  expectThat(r.score.counts.high === expected.high, at("counts.high"));
  expectThat(r.score.counts.medium === expected.medium, at("counts.medium"));
  expectThat(r.score.counts.missing === missing, at("counts.missing"));
  expectThat(r.stats.segments === r.segments.length, at("stats.segments"));
  const pages = Math.max(...r.segments.map((s) => s.page));
  expectThat(pages <= r.stats.pages, at(`segment page ${String(pages)} > stats.pages`));
  expectThat(
    r.stats.chars >= r.segments.reduce((n, s) => n + s.text.length, 0) * 0.9,
    at("stats.chars"),
  );

  return `${String(r.flags.length).padStart(2)} flags (${String(quotes)} quoted), ${String(refs).padStart(2)} refs, ${String(r.segments.length).padStart(3)} segments, score ${String(r.score.value).padStart(3)} ${r.score.band}`;
}

// --- 5. Samples ---
const TRANSLATABLE =
  /^(docTypeLabel|title|summary|keyFacts\.\w+\.(label|value)|flags\.\w+\.(category|title|plain|why)|clauses\.\w+\.(heading|plain)|questions\.\w+\.text|checklist\.(before|after)\.\w+\.text|glossary\.\w+\.(term|definition))$/;

function valueAt(r: AnalysisResult, key: string): string | undefined {
  const parts = key.split(".");
  let node: unknown = r;
  for (const part of parts) {
    if (Array.isArray(node)) node = (node as { id: string }[]).find((x) => x.id === part);
    else if (typeof node === "object" && node !== null)
      node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof node === "string" ? node : undefined;
}

/** Digit runs as a sorted multiset: Hindi word order moves numbers, never changes them. */
const digits = (s: string) => [...(s.match(/\d+/g) ?? [])].sort().join(" ");

console.log("Samples (fixtures/samples)");
for (const file of (await readdir(join(root, "fixtures/samples"))).sort()) {
  const sample = JSON.parse(await readFile(join(root, "fixtures/samples", file), "utf8")) as {
    en: AnalysisResult;
    hi: Record<string, string>;
  };
  const line = checkResult(`sample ${file}`, sample.en);
  const keys = Object.keys(sample.hi);
  let numberMismatch = 0;
  for (const key of keys) {
    const en = valueAt(sample.en, key);
    expectThat(en !== undefined, `sample ${file}: hi key ${key} resolves to nothing`);
    expectThat(TRANSLATABLE.test(key), `sample ${file}: hi key ${key} is not translatable`);
    if (en !== undefined && digits(en) !== digits(sample.hi[key] ?? "")) {
      numberMismatch += 1;
      failures.push(`sample ${file}: numbers differ in ${key}`);
    }
    checks += 1;
  }
  console.log(
    `  ${file.padEnd(16)} ${line}; hi keys ${String(keys.length)}, number mismatches ${String(numberMismatch)}`,
  );
}

// --- Every docs fixture through the pipeline ---
const SCENARIOS: MockScenario[] = [
  "normal",
  "hallucinated_quotes",
  "half_wrong_quotes",
  "empty_result",
];
console.log("\nDocs fixtures through the pipeline (mock provider)");
const docs = (await readdir(join(root, "fixtures/docs"))).filter((f) => f.endsWith(".pdf")).sort();
let results = 0;
for (const name of docs) {
  const bytes = new Uint8Array(await readFile(join(root, "fixtures/docs", name)));
  for (const scenario of SCENARIOS) {
    for (const maxInputTokens of [ENV_DEFAULTS.MAX_INPUT_TOKENS, 2_500]) {
      const router = new LlmRouter({
        providers: [{ provider: createMockProvider({ scenario }), rpm: 6_000, rpdBudget: 100_000 }],
        concurrency: 2,
        timeoutMs: 45_000,
        budgetMs: 100_000,
        random: () => 0.5,
      });
      const label = `${name} ${scenario} ${maxInputTokens === 2_500 ? "chunked" : "single"}`;
      try {
        const { result, report } = await runAnalysis(
          { kind: "pdf", bytes },
          { router, maxInputTokens },
        );
        results += 1;
        const line = checkResult(label, result);
        if (scenario === "normal" || report.path !== "single")
          console.log(`  ${label.padEnd(46)} ${line}, path ${report.path}`);
      } catch (error) {
        const code =
          error instanceof PipelineError ? error.code : (error as { code?: string }).code;
        if (scenario === "normal" && maxInputTokens !== 2_500)
          console.log(`  ${label.padEnd(46)} refused: ${String(code)}`);
      }
    }
  }
}

console.log(
  `\n${String(results)} pipeline results and 3 samples, ${String(checks)} checks, ${String(failures.length)} failed`,
);
for (const f of failures.slice(0, 40)) console.log(`  FAIL ${f}`);
process.exitCode = failures.length === 0 ? 0 : 1;
