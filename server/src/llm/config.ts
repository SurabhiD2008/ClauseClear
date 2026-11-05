// Reads the LLM settings from env (SPEC section 5). Nothing here is a model ID:
// models and keys come only from env. A provider named in LLM_PROVIDER_ORDER
// without a key, model or base URL is skipped and reported by name only.
import { ENV_DEFAULTS } from "@clauseclear/shared";
import {
  GEMINI_THINKING_LEVELS,
  createGeminiProvider,
  type GeminiThinkingLevel,
} from "./gemini.js";
import type { FetchLike } from "./http.js";
import { createMockProvider, isMockScenario, type MockScenario } from "./mock.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import type { LlmProvider, ResponseMeta } from "./provider.js";
import { LlmRouter, type LlmLogEntry, type RoutedProvider } from "./router.js";

export type Env = Record<string, string | undefined>;

export interface ProviderConfig {
  name: string;
  kind: "gemini" | "openai" | "mock";
  apiKey: string;
  model: string;
  baseUrl: string;
  rpm: number;
  rpdBudget: number;
  /** <NAME>_MAX_OUTPUT_TOKENS: the largest output this provider is asked for (A95). */
  maxOutputTokens?: number;
  /** Gemini only: <NAME>_THINKING_LEVEL (A92). */
  thinkingLevel?: GeminiThinkingLevel;
  /** Mock only, for a second mock: <NAME>_SCENARIO and <NAME>_SLOW_MS (A158). */
  mockScenario?: MockScenario;
  mockSlowMs?: number;
}

export interface LlmConfig {
  providers: ProviderConfig[];
  /** Names from LLM_PROVIDER_ORDER that could not be used, with the missing setting. */
  skipped: { name: string; missing: string }[];
  concurrency: number;
  timeoutMs: number;
  budgetMs: number;
  maxInputTokens: number;
  mockScenario: MockScenario;
  mockSlowMs: number;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
/** "mock", "mock2", ...: mock providers, so a test server can run two (A158). */
const MOCK_NAME = /^mock\d*$/;

function text(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** A positive integer from env, or the default. A bad value is a startup error. */
function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = text(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

/** An optional Gemini thinking level from env. A bad value is a startup error. */
function thinkingLevel(env: Env, key: string): { thinkingLevel?: GeminiThinkingLevel } {
  const raw = text(env, key)?.toUpperCase();
  if (raw === undefined) return {};
  const level = GEMINI_THINKING_LEVELS.find((l) => l === raw);
  if (level === undefined)
    throw new Error(`${key} must be one of ${GEMINI_THINKING_LEVELS.join(", ")}`);
  return { thinkingLevel: level };
}

export function readLlmConfig(env: Env): LlmConfig {
  const order = (text(env, "LLM_PROVIDER_ORDER") ?? "gemini,nvidia")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");

  const providers: ProviderConfig[] = [];
  const skipped: LlmConfig["skipped"] = [];

  for (const name of new Set(order)) {
    if (!NAME_PATTERN.test(name)) {
      skipped.push({ name, missing: "a valid name (lowercase letters, digits, _)" });
      continue;
    }
    const prefix = name.toUpperCase();
    if (MOCK_NAME.test(name)) {
      // "mock" uses MOCK_SCENARIO and MOCK_SLOW_MS (read below for every mock);
      // "mock2" and on may set their own, so one can fail while another answers.
      const own = name === "mock" ? undefined : text(env, `${prefix}_SCENARIO`);
      if (own !== undefined && !isMockScenario(own))
        throw new Error(`${prefix}_SCENARIO is not a known scenario`);
      const ownSlow = name === "mock" ? undefined : text(env, `${prefix}_SLOW_MS`);
      providers.push({
        name,
        kind: "mock",
        apiKey: "",
        model: "mock-fixtures",
        baseUrl: "",
        rpm: positiveInt(env, "MOCK_RPM", ENV_DEFAULTS.MOCK_RPM),
        rpdBudget: positiveInt(env, "MOCK_RPD_BUDGET", ENV_DEFAULTS.MOCK_RPD_BUDGET),
        ...(own === undefined ? {} : { mockScenario: own }),
        ...(ownSlow === undefined ? {} : { mockSlowMs: positiveInt(env, `${prefix}_SLOW_MS`, 1) }),
      });
      continue;
    }

    const kind = name === "gemini" ? "gemini" : "openai";
    const defaults: Record<string, { baseUrl?: string; rpm: number; rpd: number }> = {
      gemini: {
        baseUrl: ENV_DEFAULTS.GEMINI_BASE_URL,
        rpm: ENV_DEFAULTS.GEMINI_RPM,
        rpd: ENV_DEFAULTS.GEMINI_RPD_BUDGET,
      },
      nvidia: {
        baseUrl: ENV_DEFAULTS.NVIDIA_BASE_URL,
        rpm: ENV_DEFAULTS.NVIDIA_RPM,
        rpd: ENV_DEFAULTS.NVIDIA_RPD_BUDGET,
      },
    };
    const known = defaults[name];
    const apiKey = text(env, `${prefix}_API_KEY`);
    const model = text(env, `${prefix}_MODEL`);
    const baseUrl = text(env, `${prefix}_BASE_URL`) ?? known?.baseUrl;
    const missing = [
      apiKey === undefined ? `${prefix}_API_KEY` : undefined,
      model === undefined ? `${prefix}_MODEL` : undefined,
      baseUrl === undefined ? `${prefix}_BASE_URL` : undefined,
    ].filter((item): item is string => item !== undefined);
    if (apiKey === undefined || model === undefined || baseUrl === undefined) {
      skipped.push({ name, missing: missing.join(", ") });
      continue;
    }
    providers.push({
      name,
      kind,
      apiKey,
      model,
      baseUrl,
      rpm: positiveInt(env, `${prefix}_RPM`, known?.rpm ?? ENV_DEFAULTS.OPENAI_COMPAT_RPM),
      rpdBudget: positiveInt(
        env,
        `${prefix}_RPD_BUDGET`,
        known?.rpd ?? ENV_DEFAULTS.OPENAI_COMPAT_RPD_BUDGET,
      ),
      ...(kind === "gemini" ? thinkingLevel(env, `${prefix}_THINKING_LEVEL`) : {}),
      ...(text(env, `${prefix}_MAX_OUTPUT_TOKENS`) === undefined
        ? {}
        : { maxOutputTokens: positiveInt(env, `${prefix}_MAX_OUTPUT_TOKENS`, 1) }),
    });
  }

  const scenario = text(env, "MOCK_SCENARIO") ?? "normal";
  if (!isMockScenario(scenario)) throw new Error("MOCK_SCENARIO is not a known scenario");

  return {
    providers,
    skipped,
    concurrency: positiveInt(env, "LLM_CONCURRENCY", ENV_DEFAULTS.LLM_CONCURRENCY),
    timeoutMs: positiveInt(env, "LLM_TIMEOUT_MS", ENV_DEFAULTS.LLM_TIMEOUT_MS),
    budgetMs: positiveInt(env, "ANALYSIS_BUDGET_MS", ENV_DEFAULTS.ANALYSIS_BUDGET_MS),
    maxInputTokens: positiveInt(env, "MAX_INPUT_TOKENS", ENV_DEFAULTS.MAX_INPUT_TOKENS),
    mockScenario: scenario,
    mockSlowMs: positiveInt(env, "MOCK_SLOW_MS", ENV_DEFAULTS.MOCK_SLOW_MS),
  };
}

export interface BuildOptions {
  fetch?: FetchLike;
  onResponse?: (provider: string, meta: ResponseMeta) => void;
}

export function buildProvider(
  config: ProviderConfig,
  mock: Pick<LlmConfig, "mockScenario" | "mockSlowMs">,
  options: BuildOptions = {},
) {
  const common = {
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.onResponse === undefined
      ? {}
      : { onResponse: (meta: ResponseMeta) => options.onResponse?.(config.name, meta) }),
  };
  if (config.kind === "mock") {
    return createMockProvider({
      name: config.name,
      scenario: config.mockScenario ?? mock.mockScenario,
      slowMs: config.mockSlowMs ?? mock.mockSlowMs,
    });
  }
  if (config.kind === "gemini") {
    return createGeminiProvider({
      name: config.name,
      ...common,
      ...(config.thinkingLevel === undefined ? {} : { thinkingLevel: config.thinkingLevel }),
    });
  }
  return createOpenAiCompatibleProvider({ name: config.name, ...common });
}

export function createRouterFromConfig(
  config: LlmConfig,
  log?: (entry: LlmLogEntry) => void,
  /** Wraps each built provider; test:live uses it for its call budget (A91). */
  wrap: (provider: LlmProvider) => LlmProvider = (provider) => provider,
): LlmRouter {
  const providers: RoutedProvider[] = config.providers.map((provider) => ({
    provider: wrap(buildProvider(provider, config)),
    rpm: provider.rpm,
    rpdBudget: provider.rpdBudget,
    ...(provider.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: provider.maxOutputTokens }),
  }));
  return new LlmRouter({
    providers,
    concurrency: config.concurrency,
    timeoutMs: config.timeoutMs,
    budgetMs: config.budgetMs,
    ...(log === undefined ? {} : { log }),
  });
}
