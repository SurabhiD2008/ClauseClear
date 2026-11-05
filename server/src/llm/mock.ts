// The mock provider (SPEC section 12): replays fixtures and injected failures so
// tests never need a key or the network. The scenario comes from MOCK_SCENARIO,
// or, only when NODE_ENV is "test", from the x-mock-scenario request header,
// carried to the provider through AsyncLocalStorage (ASSUMPTIONS A58).
import { AsyncLocalStorage } from "node:async_hooks";
import { ENV_DEFAULTS, validResult } from "@clauseclear/shared";
import {
  BadOutputError,
  RateLimitError,
  TransientError,
  type GenerateJsonRequest,
  type GenerateJsonResult,
  type LlmProvider,
} from "./provider.js";
import { mockModelAnswer } from "./mockModel.js";

export const MOCK_SCENARIOS = [
  "normal",
  "rate_limit",
  "rate_limit_no_retry_after",
  "server_error",
  "timeout",
  "malformed_json",
  "truncated_json",
  "hallucinated_quotes",
  "half_wrong_quotes",
  "empty_result",
  "oversized_result",
  "not_legal",
  "slow",
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export const MOCK_SCENARIO_HEADER = "x-mock-scenario";
/** Retry-After the rate_limit scenario reports. */
export const MOCK_RETRY_AFTER_MS = 2_000;
const HALLUCINATED_QUOTE = "The licensee may keep a pet elephant on the premises.";

export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === "string" && (MOCK_SCENARIOS as readonly string[]).includes(value);
}

const scenarioStore = new AsyncLocalStorage<MockScenario>();

/** The header's scenario, honoured only in tests; anything else is ignored. */
export function scenarioFromHeader(
  value: string | string[] | undefined,
  nodeEnv: string | undefined,
): MockScenario | undefined {
  if (nodeEnv !== "test") return undefined;
  const single = Array.isArray(value) ? value[0] : value;
  return isMockScenario(single) ? single : undefined;
}

/** Runs fn with a per-request scenario (set by the analyze route from the header). */
export function runWithMockScenario<T>(scenario: MockScenario | undefined, fn: () => T): T {
  return scenario === undefined ? fn() : scenarioStore.run(scenario, fn);
}

/**
 * The answer for a request: the mock model reads the real prompts (mockModel.ts).
 * A request without a document block (provider and router tests) gets the shared
 * valid result, so those tests keep a fixed, schema-valid body.
 */
function fixtureFor(
  request: Pick<GenerateJsonRequest, "schemaName" | "system" | "user">,
): Record<string, unknown> {
  return mockModelAnswer(request.schemaName, request.system, request.user) ?? validResult();
}

interface FixtureFlag {
  quote?: unknown;
}

function withQuotes(fixture: Record<string, unknown>, wrong: (index: number) => boolean) {
  const flags = Array.isArray(fixture.flags) ? (fixture.flags as FixtureFlag[]) : [];
  let present = 0;
  return {
    ...fixture,
    flags: flags.map((flag) => {
      if (typeof flag.quote !== "string") return flag;
      const index = present;
      present += 1;
      return wrong(index) ? { ...flag, quote: HALLUCINATED_QUOTE } : flag;
    }),
  };
}

export function scenarioOutput(
  scenario: MockScenario,
  request: Pick<GenerateJsonRequest, "schemaName" | "maxOutputTokens" | "system" | "user">,
): string {
  const fixture = fixtureFor(request);
  switch (scenario) {
    case "hallucinated_quotes":
      return JSON.stringify(withQuotes(fixture, () => true));
    case "half_wrong_quotes":
      return JSON.stringify(withQuotes(fixture, (index) => index % 2 === 0));
    case "empty_result":
      return JSON.stringify({
        ...fixture,
        flags: [],
        keyFacts: [],
        clauses: [],
        questions: [],
        glossary: [],
        checklist: { before: [], after: [] },
      });
    case "oversized_result":
      // Far past maxOutputTokens: the pipeline must reject it, never store or echo it.
      return JSON.stringify({
        ...fixture,
        summary: "x".repeat(request.maxOutputTokens * 8),
      });
    case "not_legal":
      return JSON.stringify({ notLegal: true });
    case "malformed_json":
      return "{ this is not JSON";
    case "truncated_json": {
      const full = JSON.stringify(fixture);
      return full.slice(0, Math.floor(full.length / 2));
    }
    default:
      return JSON.stringify(fixture);
  }
}

export interface MockOptions {
  scenario: MockScenario;
  slowMs?: number;
  /** "mock" by default; a second mock ("mock2") lets e2e prove fallback (A158). */
  name?: string;
}

export function createMockProvider(options: MockOptions): LlmProvider {
  const slowMs = options.slowMs ?? ENV_DEFAULTS.MOCK_SLOW_MS;
  const name = options.name ?? "mock";

  const waitOrAbort = (ms: number | undefined, signal: AbortSignal | undefined) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason as Error);
        return;
      }
      const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason as Error);
        },
        { once: true },
      );
    });

  return {
    name,
    model: "mock-fixtures",
    async generateJson(request): Promise<GenerateJsonResult> {
      const scenario = scenarioStore.getStore() ?? options.scenario;
      switch (scenario) {
        case "rate_limit":
          throw new RateLimitError(name, MOCK_RETRY_AFTER_MS);
        case "rate_limit_no_retry_after":
          throw new RateLimitError(name);
        case "server_error":
          throw new TransientError(name, "HTTP 500", 500);
        case "timeout":
          // Never answers; the router's per-call timeout aborts the signal.
          await waitOrAbort(undefined, request.signal);
          throw new BadOutputError(name, "empty");
        case "slow":
          await waitOrAbort(slowMs, request.signal);
          break;
        default:
          break;
      }
      return { text: scenarioOutput(scenario, request) };
    },
  };
}
