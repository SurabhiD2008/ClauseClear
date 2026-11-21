// npm run eval: the evaluation set (eval/cases.json) against the mock provider.
// npm run eval:live: the same cases against the real providers in .env, with a
// hard cap on calls, saving the run to .planning/evidence/ (never committed).
// Tuned and held-out cases are reported apart. Exits 1 if any outcome decided in
// code fails, or, with --live, if any case fails.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createRouterFromConfig, readLlmConfig } from "../server/src/llm/config.js";
import type { LlmLogEntry } from "../server/src/llm/router.js";
import { PROMPT_VERSION } from "../server/src/pipeline/prompts/index.js";
import { loadCases, runCase, summarise, type CaseOutcome } from "../server/src/eval/evalSet.js";
import { callBudget, maxCallsArg } from "./call-budget.js";

/** Calls a live run may make: about two per case for the 25 cases that reach the model. */
const EVAL_LIVE_MAX_CALLS = 70;

const { values } = parseArgs({
  options: { live: { type: "boolean" }, "max-calls": { type: "string" }, only: { type: "string" } },
});
const live = values.live === true;
if (live && existsSync(".env")) process.loadEnvFile(".env");
const config = readLlmConfig(live ? process.env : { LLM_PROVIDER_ORDER: "mock" });
const providers = live ? config.providers.filter((p) => p.kind !== "mock") : config.providers;
if (providers.length === 0) {
  console.error("eval:live: no real provider is configured in .env (see .env.example).");
  process.exit(1);
}

const calls: Omit<LlmLogEntry, "event">[] = [];
const budget = callBudget(maxCallsArg(values["max-calls"], EVAL_LIVE_MAX_CALLS));
const router = createRouterFromConfig(
  { ...config, providers },
  (entry) => {
    if (entry.event !== "llm_exhausted" && !budget.takeBlocked()) calls.push(entry);
  },
  live ? budget.wrap : (p) => p,
);

const cases = loadCases().filter((c) => values.only === undefined || c.id === values.only);
const outcomes: CaseOutcome[] = [];
for (const c of cases) {
  const outcome = await runCase(c, router, config.maxInputTokens);
  outcomes.push(outcome);
  const failures = [...outcome.codeFailures, ...outcome.modelFailures];
  const result =
    outcome.refused ??
    `${outcome.docType ?? "?"}, ${String(outcome.flags ?? 0)} flags, score ${String(outcome.score ?? 0)}`;
  console.log(
    `${failures.length === 0 ? "PASS" : "FAIL"}  ${c.split.padEnd(7)} ${c.kind.padEnd(11)} ${c.id.padEnd(28)} ${result}${failures.length === 0 ? "" : `  (${failures.join("; ")})`}`,
  );
}

const summary = summarise(outcomes);
console.log("");
for (const s of summary)
  console.log(`${s.split.padEnd(7)} ${String(s.passed)}/${String(s.cases)} cases passed`);
const codeFailures = outcomes.filter((o) => o.codeFailures.length > 0).length;
console.log(
  `outcomes decided in code: ${codeFailures === 0 ? "all hold" : `${String(codeFailures)} case(s) failed`}`,
);
console.log(
  `provider: ${providers.map((p) => `${p.name} (${p.model})`).join(", ")}; prompt version ${PROMPT_VERSION}; calls ${String(calls.length)}`,
);

if (live) {
  const dir = path.join(".planning", "evidence");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `eval-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const log = {
    promptVersion: PROMPT_VERSION,
    providers: providers.map((p) => ({ name: p.name, model: p.model })),
    summary,
    outcomes,
    calls,
  };
  writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
  console.log(`saved ${file}`);
}
const failed = live
  ? outcomes.some((o) => o.codeFailures.length + o.modelFailures.length > 0)
  : codeFailures > 0;
process.exitCode = failed ? 1 : 0;
