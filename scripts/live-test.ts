// npm run test:live (SPEC section 12, prompt 8, A91). Sends the rental,
// employment and loan fixtures through the real pipeline with the real
// providers from .env, one at a time, with a hard cap of LIVE_TEST_MAX_CALLS
// model calls for the whole run. Writes docs/evidence/live-run-<timestamp>.json
// and prints the summary table. Never part of npm test or the audit.
//
//   --only <fixture>     run one fixture (for example rental)
//   --invalid-key <name> replace that provider's key in memory with an invalid
//                        one, to prove the fallback; .env is never touched
//   --order <a,b>        use only these providers, in this order
//   --model <name=id>    use another model for one provider (repeatable)
//   --max-calls <n>      another cap for this run; above LIVE_TEST_MAX_CALLS only
//                        when the user has approved that many calls (A96)
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LIVE_TEST_MAX_CALLS } from "@clauseclear/shared";
import { createRouterFromConfig, readLlmConfig } from "../server/src/llm/config.js";
import { LlmRouterError, type LlmLogEntry } from "../server/src/llm/router.js";
import { PipelineError } from "../server/src/pipeline/errors.js";
import { PROMPT_VERSION } from "../server/src/pipeline/prompts/index.js";
import { runAnalysis } from "../server/src/pipeline/run.js";
import { callBudget, maxCallsArg } from "./call-budget.js";
import { formatTable, summarize, type LiveDocument, type LiveLog } from "./live-log.js";

const FIXTURES = ["rental.pdf", "employment.pdf", "loan.pdf"];
const INVALID_KEY = "invalid-key-for-the-fallback-test";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    "invalid-key": { type: "string", multiple: true },
    order: { type: "string" },
    model: { type: "string", multiple: true },
    "max-calls": { type: "string" },
  },
});

if (existsSync(".env")) process.loadEnvFile(".env");
const config = readLlmConfig(process.env);
const invalidKeys = values["invalid-key"] ?? [];
const models = new Map(
  (values.model ?? []).map((pair) => {
    const at = pair.indexOf("=");
    return [pair.slice(0, at), pair.slice(at + 1)] as const;
  }),
);
const order = values.order?.split(",").map((n) => n.trim());
const maxCalls = maxCallsArg(values["max-calls"], LIVE_TEST_MAX_CALLS);
const providers = config.providers
  .filter((p) => p.kind !== "mock" && (order === undefined || order.includes(p.name)))
  .sort((a, b) => (order === undefined ? 0 : order.indexOf(a.name) - order.indexOf(b.name)))
  .map((p) => ({ ...p, model: models.get(p.name) ?? p.model }))
  .map((p) => (invalidKeys.includes(p.name) ? { ...p, apiKey: INVALID_KEY } : p));
if (providers.length === 0) {
  console.error("test:live: no real provider is configured in .env (see .env.example).");
  process.exit(1);
}
for (const { name, missing } of config.skipped) console.log(`skipped ${name}: missing ${missing}`);

const budget = callBudget(maxCalls);

let current: LiveDocument | undefined;
const onLog = (entry: LlmLogEntry) => {
  if (current === undefined) return;
  if (entry.event === "llm_exhausted") {
    current.exhausted.push(entry);
  } else if (budget.takeBlocked()) {
    // A call the budget refused never reached the provider: not logged as a call.
  } else {
    current.calls.push(entry);
  }
};

// The server's own builder, so per-provider settings such as the output cap
// (A95) are never left out here.
const router = createRouterFromConfig({ ...config, providers }, onLog, budget.wrap);

const log: LiveLog = {
  startedAt: new Date().toISOString(),
  promptVersion: PROMPT_VERSION,
  providerOrder: providers.map((p) => p.name),
  models: Object.fromEntries(providers.map((p) => [p.name, p.model])),
  invalidKeys,
  callBudget: maxCalls,
  callsMade: 0,
  callsBlockedByBudget: 0,
  documents: [],
};

const fixtures =
  values.only === undefined ? FIXTURES : [`${values.only.replace(/\.pdf$/, "")}.pdf`];
for (const fixture of fixtures) {
  const doc: LiveDocument = { fixture, ok: false, ms: 0, calls: [], exhausted: [] };
  current = doc;
  log.documents.push(doc);
  const started = Date.now();
  console.log(`\n${fixture}: running (calls so far ${String(budget.made)}/${String(maxCalls)})`);
  try {
    const bytes = new Uint8Array(await readFile(join("fixtures", "docs", fixture)));
    const { result, report } = await runAnalysis(
      { kind: "pdf", bytes },
      {
        router,
        maxInputTokens: config.maxInputTokens,
        deadline: Date.now() + config.budgetMs,
        onProgress: (event) => {
          console.log(`  ${event.step}${event.detail === undefined ? "" : `: ${event.detail}`}`);
        },
      },
    );
    Object.assign(doc, {
      ok: true,
      docType: result.docType,
      docTypeConfidence: result.docTypeConfidence,
      path: report.path,
      pages: report.pages,
      segments: report.segments,
      attempts: report.attempts,
      score: { value: result.score.value, band: result.score.band, ...result.score.counts },
      warnings: result.warnings,
      keyFacts: result.keyFacts.length,
      questions: result.questions.length,
      glossary: result.glossary.length,
    });
  } catch (error) {
    doc.error =
      error instanceof PipelineError || error instanceof LlmRouterError
        ? error.code
        : error instanceof Error
          ? error.name
          : "unknown";
    console.log(`  failed: ${doc.error}`);
  }
  doc.ms = Date.now() - started;
}
current = undefined;
log.callsMade = budget.made;
log.callsBlockedByBudget = budget.blocked;

await mkdir(join("docs", "evidence"), { recursive: true });
const file = join("docs", "evidence", `live-run-${log.startedAt.replace(/[:.]/g, "-")}.json`);
await writeFile(file, `${JSON.stringify(log, null, 2)}\n`);

console.log(`\n${formatTable(summarize(log))}`);
console.log(
  `\ncalls made ${String(budget.made)} of ${String(maxCalls)}; blocked by budget ${String(budget.blocked)}`,
);
console.log(`run log: ${file}`);
process.exitCode = log.documents.every((d) => d.ok) ? 0 : 1;
