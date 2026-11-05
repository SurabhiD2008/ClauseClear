import { ENV_DEFAULTS } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { createRouterFromConfig, readLlmConfig } from "./config.js";

const full = {
  LLM_PROVIDER_ORDER: "gemini, nvidia",
  GEMINI_API_KEY: "gemini-key-0000",
  GEMINI_MODEL: "model-from-env-a",
  NVIDIA_API_KEY: "nvidia-key-0000",
  NVIDIA_MODEL: "vendor/model-from-env-b",
};

describe("readLlmConfig", () => {
  it("builds providers in LLM_PROVIDER_ORDER with models, keys and URLs from env", () => {
    const config = readLlmConfig(full);
    expect(config.providers.map((p) => [p.name, p.kind, p.model, p.baseUrl])).toEqual([
      ["gemini", "gemini", "model-from-env-a", ENV_DEFAULTS.GEMINI_BASE_URL],
      ["nvidia", "openai", "vendor/model-from-env-b", ENV_DEFAULTS.NVIDIA_BASE_URL],
    ]);
    expect(config.skipped).toEqual([]);
  });

  it("uses the SPEC section 5 defaults", () => {
    const config = readLlmConfig(full);
    expect(config.providers.map((p) => [p.rpm, p.rpdBudget])).toEqual([
      [ENV_DEFAULTS.GEMINI_RPM, ENV_DEFAULTS.GEMINI_RPD_BUDGET],
      [ENV_DEFAULTS.NVIDIA_RPM, ENV_DEFAULTS.NVIDIA_RPD_BUDGET],
    ]);
    expect([config.concurrency, config.timeoutMs, config.budgetMs, config.maxInputTokens]).toEqual([
      2, 45_000, 100_000, 24_000,
    ]);
  });

  it("reads GEMINI_THINKING_LEVEL for Gemini only, in any case, and rejects unknown levels", () => {
    expect(readLlmConfig(full).providers[0]?.thinkingLevel).toBeUndefined();
    const config = readLlmConfig({
      ...full,
      GEMINI_THINKING_LEVEL: "low",
      NVIDIA_THINKING_LEVEL: "HIGH",
    });
    expect(config.providers.map((p) => p.thinkingLevel)).toEqual(["LOW", undefined]);
    expect(() => readLlmConfig({ ...full, GEMINI_THINKING_LEVEL: "max" })).toThrow(
      "GEMINI_THINKING_LEVEL must be one of MINIMAL, LOW, MEDIUM, HIGH",
    );
  });

  it("reads <NAME>_MAX_OUTPUT_TOKENS as a per-provider output cap (A95)", () => {
    expect(readLlmConfig(full).providers.map((p) => p.maxOutputTokens)).toEqual([
      undefined,
      undefined,
    ]);
    const config = readLlmConfig({ ...full, NVIDIA_MAX_OUTPUT_TOKENS: "3072" });
    expect(config.providers.map((p) => p.maxOutputTokens)).toEqual([undefined, 3072]);
    expect(() => readLlmConfig({ ...full, NVIDIA_MAX_OUTPUT_TOKENS: "0" })).toThrow(
      "NVIDIA_MAX_OUTPUT_TOKENS must be a positive integer",
    );
  });

  it("the router built from config keeps each provider's output cap", () => {
    const config = readLlmConfig({ ...full, NVIDIA_MAX_OUTPUT_TOKENS: "3072" });
    expect(createRouterFromConfig(config).smallestOutputCap).toBe(3072);
    expect(createRouterFromConfig(readLlmConfig(full)).smallestOutputCap).toBeUndefined();
  });

  it("has no default model: a provider without a model is skipped, and named", () => {
    const config = readLlmConfig({ ...full, GEMINI_MODEL: "", NVIDIA_API_KEY: undefined });
    expect(config.providers).toEqual([]);
    expect(config.skipped).toEqual([
      { name: "gemini", missing: "GEMINI_MODEL" },
      { name: "nvidia", missing: "NVIDIA_API_KEY" },
    ]);
    expect(JSON.stringify(config.skipped)).not.toContain("key-0000");
  });

  it("adds any extra OpenAI-compatible endpoint from its own env block", () => {
    const config = readLlmConfig({
      LLM_PROVIDER_ORDER: "groq,mock",
      GROQ_API_KEY: "k-123456789",
      GROQ_MODEL: "some-model",
      GROQ_BASE_URL: "https://example.test/openai/v1",
      GROQ_RPM: "5",
    });
    expect(config.providers.map((p) => [p.name, p.kind, p.rpm, p.rpdBudget])).toEqual([
      ["groq", "openai", 5, ENV_DEFAULTS.OPENAI_COMPAT_RPD_BUDGET],
      ["mock", "mock", ENV_DEFAULTS.MOCK_RPM, ENV_DEFAULTS.MOCK_RPD_BUDGET],
    ]);
  });

  it("an extra endpoint without a base URL is skipped", () => {
    const config = readLlmConfig({
      LLM_PROVIDER_ORDER: "other",
      OTHER_API_KEY: "k",
      OTHER_MODEL: "m",
    });
    expect(config.skipped).toEqual([{ name: "other", missing: "OTHER_BASE_URL" }]);
  });

  it("rejects a non-numeric or zero limit at startup, naming only the variable", () => {
    expect(() => readLlmConfig({ ...full, LLM_CONCURRENCY: "0" })).toThrow("LLM_CONCURRENCY");
    expect(() => readLlmConfig({ ...full, GEMINI_RPM: "fast" })).toThrow("GEMINI_RPM");
  });

  it("rejects an unknown MOCK_SCENARIO", () => {
    expect(() => readLlmConfig({ LLM_PROVIDER_ORDER: "mock", MOCK_SCENARIO: "chaos" })).toThrow(
      "MOCK_SCENARIO",
    );
  });

  it("builds a router whose provider order matches the env", () => {
    const router = createRouterFromConfig(
      readLlmConfig({ ...full, LLM_PROVIDER_ORDER: "nvidia,gemini,mock" }),
    );
    expect(router.providerNames).toEqual(["nvidia", "gemini", "mock"]);
  });

  it("a second mock has its own scenario and delay; the first keeps MOCK_SCENARIO (A158)", () => {
    const config = readLlmConfig({
      LLM_PROVIDER_ORDER: "mock,mock2",
      MOCK_SCENARIO: "rate_limit",
      MOCK2_SCENARIO: "slow",
      MOCK2_SLOW_MS: "10",
    });
    expect(config.providers.map((p) => [p.name, p.kind, p.mockScenario, p.mockSlowMs])).toEqual([
      ["mock", "mock", undefined, undefined],
      ["mock2", "mock", "slow", 10],
    ]);
    expect(() =>
      readLlmConfig({ LLM_PROVIDER_ORDER: "mock,mock2", MOCK2_SCENARIO: "chaos" }),
    ).toThrow("MOCK2_SCENARIO");
  });

  it("a 429 from the first mock falls back to the second, which answers (A158)", async () => {
    const router = createRouterFromConfig(
      readLlmConfig({
        LLM_PROVIDER_ORDER: "mock,mock2",
        MOCK_SCENARIO: "rate_limit",
        MOCK2_SCENARIO: "normal",
      }),
    );
    expect(router.providerNames).toEqual(["mock", "mock2"]);
    const result = await router.generate(
      { schemaName: "t", system: "s", user: "u", maxOutputTokens: 100 },
      { parse: (_name: string, text: string) => text, repairRetries: 0 },
    );
    expect(result.provider).toBe("mock2");
  });
});
