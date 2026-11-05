// npm run samples (prompt 9, A98; replaces the mock stubs of A85). Runs the
// rental, employment and loan fixture PDFs once through the real pipeline with
// the real providers from .env, translates each result's translatable strings
// to Hindi through the same checks as /api/translate, and writes
// fixtures/samples/<id>.json with en, hi and hiReviewed: false. A sample that
// fails keeps its old file. The run log (calls, no text) goes to docs/evidence.
//
//   --only <id>          build one sample (rental, job-offer or loan)
//   --max-calls <n>      cap on real model calls (default SAMPLES_BUILD_MAX_CALLS)
//   --order <a,b>        use only these providers, in this order (for example gemini)
//   --model <name=id>    use another model for one provider (repeatable); .env is not touched
//   --mock               use the mock provider instead: no network, for an offline build
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  extractTranslatable,
  sampleFileSchema,
  SAMPLES_BUILD_MAX_CALLS,
  type SampleFile,
} from "@clauseclear/shared";
import { format, resolveConfig } from "prettier";
import { createRouterFromConfig, readLlmConfig } from "../server/src/llm/config.js";
import { LlmRouterError, type LlmLogEntry, type LlmRouter } from "../server/src/llm/router.js";
import { PipelineError } from "../server/src/pipeline/errors.js";
import { PROMPT_VERSION } from "../server/src/pipeline/prompts/index.js";
import { runAnalysis } from "../server/src/pipeline/run.js";
import { recordingRouter } from "../server/src/pipeline/testing/harness.js";
import { TRANSLATE_PROMPT_VERSION } from "../server/src/translate/prompts.js";
import { translateStrings } from "../server/src/translate/translate.js";
import { callBudget, maxCallsArg } from "./call-budget.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures", "samples");
const SAMPLES: { id: string; pdf: string }[] = [
  { id: "rental", pdf: "rental.pdf" },
  { id: "job-offer", pdf: "employment.pdf" },
  { id: "loan", pdf: "loan.pdf" },
];

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    "max-calls": { type: "string" },
    order: { type: "string" },
    model: { type: "string", multiple: true },
    mock: { type: "boolean", default: false },
  },
});

interface SampleRunLog {
  id: string;
  ok: boolean;
  error?: string;
  flags?: number;
  score?: number;
  translatable?: number;
  unchanged?: string[];
  translateCalls?: number;
  calls: Extract<LlmLogEntry, { event: "llm_call" }>[];
}

if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const config = readLlmConfig(process.env);
const models = new Map(
  (values.model ?? []).map((pair) => {
    const at = pair.indexOf("=");
    return [pair.slice(0, at), pair.slice(at + 1)] as const;
  }),
);
const maxCalls = maxCallsArg(values["max-calls"], SAMPLES_BUILD_MAX_CALLS);
const budget = callBudget(maxCalls);
let current: SampleRunLog | undefined;
const onLog = (entry: LlmLogEntry) => {
  if (entry.event !== "llm_call" || budget.takeBlocked()) return;
  current?.calls.push(entry);
};

let router: LlmRouter;
if (values.mock) {
  router = recordingRouter().router;
} else {
  const order = values.order?.split(",").map((n) => n.trim());
  const providers = config.providers
    .filter((p) => p.kind !== "mock" && (order === undefined || order.includes(p.name)))
    .sort((a, b) => (order === undefined ? 0 : order.indexOf(a.name) - order.indexOf(b.name)))
    .map((p) => ({ ...p, model: models.get(p.name) ?? p.model }));
  if (providers.length === 0) {
    console.error(
      "samples: no real provider is configured in .env; use --mock for an offline build.",
    );
    process.exit(1);
  }
  router = createRouterFromConfig({ ...config, providers }, onLog, budget.wrap);
}

const wanted = values.only === undefined ? SAMPLES : SAMPLES.filter((s) => s.id === values.only);
const runs: SampleRunLog[] = [];
await mkdir(outDir, { recursive: true });
for (const { id, pdf } of wanted) {
  const run: SampleRunLog = { id, ok: false, calls: [] };
  current = run;
  runs.push(run);
  try {
    const bytes = new Uint8Array(await readFile(join(root, "fixtures", "docs", pdf)));
    const { result } = await runAnalysis(
      { kind: "pdf", bytes },
      { router, maxInputTokens: config.maxInputTokens, deadline: Date.now() + config.budgetMs },
    );
    const english = extractTranslatable(result);
    const hindi = await translateStrings(english, {
      router,
      deadline: Date.now() + config.budgetMs,
    });
    const sample: SampleFile = sampleFileSchema.parse({
      id,
      title: result.title,
      docType: result.docType,
      hiReviewed: false,
      en: result,
      hi: hindi.strings,
    });
    const file = join(outDir, `${id}.json`);
    const options = (await resolveConfig(file)) ?? {};
    await writeFile(file, await format(JSON.stringify(sample), { ...options, filepath: file }));
    Object.assign(run, {
      ok: true,
      flags: result.flags.length,
      score: result.score.value,
      translatable: Object.keys(english).length,
      unchanged: hindi.unchanged,
      translateCalls: hindi.calls,
    });
    console.log(
      `${`${id}.json`.padEnd(16)} ${result.docType.padEnd(11)} flags ${String(result.flags.length).padStart(2)}  score ${String(result.score.value).padStart(3)}  hi ${String(Object.keys(english).length - hindi.unchanged.length)}/${String(Object.keys(english).length)}  calls ${String(run.calls.length)}`,
    );
  } catch (error) {
    run.error =
      error instanceof PipelineError || error instanceof LlmRouterError
        ? error.code
        : error instanceof Error
          ? error.name
          : "unknown";
    console.log(`${`${id}.json`.padEnd(16)} FAILED ${run.error}; the old file is kept`);
  }
}
current = undefined;

if (!values.mock) {
  const startedAt = new Date().toISOString();
  const log = {
    startedAt,
    promptVersion: PROMPT_VERSION,
    translatePromptVersion: TRANSLATE_PROMPT_VERSION,
    providerOrder: values.order ?? config.providers.map((p) => p.name).join(","),
    models: Object.fromEntries(
      config.providers.map((p) => [p.name, models.get(p.name) ?? p.model]),
    ),
    callBudget: maxCalls,
    callsMade: budget.made,
    callsBlockedByBudget: budget.blocked,
    samples: runs,
  };
  await mkdir(join(root, "docs", "evidence"), { recursive: true });
  const file = join(
    root,
    "docs",
    "evidence",
    `samples-run-${startedAt.replace(/[:.]/g, "-")}.json`,
  );
  const options = (await resolveConfig(file)) ?? {};
  await writeFile(file, await format(JSON.stringify(log), { ...options, filepath: file }));
  console.log(`calls made ${String(budget.made)} of ${String(maxCalls)}; run log: ${file}`);
}
process.exitCode = runs.every((r) => r.ok) ? 0 : 1;
