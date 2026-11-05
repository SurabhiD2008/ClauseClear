// Runs a fixture through the real analysis pipeline with the mock provider and
// prints the exact prompts the router sent (first 40 lines of each by default).
// No network, no key.
//   npm run prompts:show -- rental.pdf [lines]
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_DEFAULTS } from "@clauseclear/shared";
import { createMockProvider } from "../server/src/llm/mock.js";
import type { GenerateJsonRequest, LlmProvider } from "../server/src/llm/provider.js";
import { LlmRouter } from "../server/src/llm/router.js";
import { analyzeDocument } from "../server/src/pipeline/analyze.js";
import { readPdf } from "../server/src/pipeline/extract.js";
import { segmentDocument } from "../server/src/pipeline/segment.js";

const name = process.argv[2] ?? "rental.pdf";
const lines = Number(process.argv[3] ?? "40");
const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "docs");

const sent: GenerateJsonRequest[] = [];
const mock = createMockProvider({ scenario: "normal" });
const recording: LlmProvider = {
  name: mock.name,
  model: mock.model,
  generateJson(request) {
    sent.push(request);
    return mock.generateJson(request);
  },
};
const router = new LlmRouter({
  providers: [{ provider: recording, rpm: 600, rpdBudget: 1_000 }],
  concurrency: ENV_DEFAULTS.LLM_CONCURRENCY,
  timeoutMs: ENV_DEFAULTS.LLM_TIMEOUT_MS,
  budgetMs: ENV_DEFAULTS.ANALYSIS_BUDGET_MS,
});

const doc = await readPdf(new Uint8Array(await readFile(join(docs, name))));
const { draft, detection } = await analyzeDocument({
  router,
  segments: segmentDocument(doc.pages),
  pages: doc.pageCount,
  maxInputTokens: ENV_DEFAULTS.MAX_INPUT_TOKENS,
});

console.log(
  `${name}: type ${detection.docType} (${detection.method}), path ${draft.path}, ${String(sent.length)} call(s) sent`,
);
for (const [index, request] of sent.entries()) {
  for (const part of ["system", "user"] as const) {
    const all = request[part].split("\n");
    console.log(
      `\n===== call ${String(index + 1)} (${request.schemaName}) ${part} prompt: first ${String(Math.min(lines, all.length))} of ${String(all.length)} lines =====`,
    );
    console.log(all.slice(0, lines).join("\n"));
  }
}
