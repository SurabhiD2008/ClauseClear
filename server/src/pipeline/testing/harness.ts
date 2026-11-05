// Test helpers for the analysis pipeline: fixtures as segments, and a router
// over the mock provider that records every request and its concurrency.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ENV_DEFAULTS, type Segment } from "@clauseclear/shared";
import { createMockProvider, type MockScenario } from "../../llm/mock.js";
import { AuthError, type GenerateJsonRequest, type LlmProvider } from "../../llm/provider.js";
import { LlmRouter } from "../../llm/router.js";
import { readPdf } from "../extract.js";
import { segmentDocument } from "../segment.js";

const docs = fileURLToPath(new URL("../../../../fixtures/docs/", import.meta.url));

export async function fixtureSegments(
  name: string,
): Promise<{ segments: Segment[]; pages: number }> {
  const doc = await readPdf(new Uint8Array(await readFile(`${docs}${name}`)));
  return { segments: segmentDocument(doc.pages), pages: doc.pageCount };
}

export interface Recorder {
  router: LlmRouter;
  requests: GenerateJsonRequest[];
  peakInFlight: () => number;
}

export interface RecorderOptions {
  scenario?: MockScenario;
  /** Delay before each answer, so parallel calls overlap. */
  delayMs?: number;
  slowMs?: number;
  /** Calls in flight across the router; defaults to LLM_CONCURRENCY. */
  concurrency?: number;
  /** Total budget per analysis, as ANALYSIS_BUDGET_MS. */
  budgetMs?: number;
  /**
   * Puts a provider that always fails (an invalid key) in front of the mock,
   * and caps the mock's output at this many tokens (A95).
   */
  cappedFallback?: number;
  /** Replaces the mock for one schemaName. */
  override?: (request: GenerateJsonRequest) => string | undefined;
}

export function recordingRouter(options: RecorderOptions = {}): Recorder {
  const mock = createMockProvider({
    scenario: options.scenario ?? "normal",
    slowMs: options.slowMs ?? 5_000,
  });
  const requests: GenerateJsonRequest[] = [];
  let inFlight = 0;
  let peak = 0;
  const provider: LlmProvider = {
    name: "mock",
    model: "mock-fixtures",
    async generateJson(request) {
      requests.push(request);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        if (options.delayMs !== undefined) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, options.delayMs);
            request.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(request.signal?.reason as Error);
              },
              { once: true },
            );
          });
        }
        const replaced = options.override?.(request);
        if (replaced !== undefined) return { text: replaced };
        return await mock.generateJson(request);
      } finally {
        inFlight -= 1;
      }
    },
  };
  const invalidKey: LlmProvider = {
    name: "invalid-key",
    model: "none",
    generateJson: () => Promise.reject(new AuthError("invalid-key", 401)),
  };
  const router = new LlmRouter({
    providers:
      options.cappedFallback === undefined
        ? [{ provider, rpm: 600, rpdBudget: 10_000 }]
        : [
            { provider: invalidKey, rpm: 600, rpdBudget: 10_000 },
            { provider, rpm: 600, rpdBudget: 10_000, maxOutputTokens: options.cappedFallback },
          ],
    concurrency: options.concurrency ?? ENV_DEFAULTS.LLM_CONCURRENCY,
    timeoutMs: 45_000,
    budgetMs: options.budgetMs ?? ENV_DEFAULTS.ANALYSIS_BUDGET_MS,
    random: () => 0.5,
  });
  return { router, requests, peakInFlight: () => peak };
}
