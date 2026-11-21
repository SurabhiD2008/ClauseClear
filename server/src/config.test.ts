import { ENV_DEFAULTS } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import {
  CONFIG_VARIABLES,
  configDefault,
  nodeEnvOf,
  readConfig,
  readServerConfig,
} from "./config.js";

const MOCK_ENV = { LLM_PROVIDER_ORDER: "mock" };

describe("readServerConfig", () => {
  it("uses the defaults when nothing is set", () => {
    const config = readServerConfig({});
    expect(config.limits).toEqual({
      ipAnalyses: ENV_DEFAULTS.IP_ANALYSES_PER_10_MIN,
      dailyAnalyses: ENV_DEFAULTS.GLOBAL_ANALYSES_PER_DAY,
      dailyTranslations: ENV_DEFAULTS.GLOBAL_TRANSLATIONS_PER_DAY,
    });
    expect(config.trustProxy).toBe(0);
    expect(config.port).toBe(Number(configDefault("PORT")));
    expect(config.nodeEnv).toBe("development");
    expect(config.guardPages).toBe(false);
  });

  it.each([
    ["IP_ANALYSES_PER_10_MIN", "0"],
    ["IP_ANALYSES_PER_10_MIN", "1.5"],
    ["GLOBAL_ANALYSES_PER_DAY", "-1"],
    ["GLOBAL_TRANSLATIONS_PER_DAY", "lots"],
    ["TRUST_PROXY", "-1"],
    ["PORT", "0"],
    ["PORT", "1e3x"],
  ])("refuses %s=%s with a message naming the variable", (name, value) => {
    expect(() => readServerConfig({ [name]: value })).toThrow(name);
  });

  it("guard pages are on only for the exact value 1", () => {
    expect(readServerConfig({ E2E_GUARD_PAGES: "1" }).guardPages).toBe(true);
    expect(readServerConfig({ E2E_GUARD_PAGES: "true" }).guardPages).toBe(false);
  });

  it("an empty NODE_ENV counts as unset", () => {
    expect(nodeEnvOf({ NODE_ENV: "  " })).toBe("development");
    expect(nodeEnvOf({ NODE_ENV: "production" })).toBe("production");
  });
});

describe("readConfig", () => {
  it("reads the server and model settings together", () => {
    const config = readConfig(MOCK_ENV);
    expect(config.llm.providers.map((p) => p.name)).toEqual(["mock"]);
    expect(config.server.limits.ipAnalyses).toBe(ENV_DEFAULTS.IP_ANALYSES_PER_10_MIN);
  });

  it.each([
    ["LLM_TIMEOUT_MS", "0"],
    ["ANALYSIS_BUDGET_MS", "soon"],
    ["LLM_CONCURRENCY", "2.5"],
    ["MAX_INPUT_TOKENS", "-10"],
    ["MOCK_SCENARIO", "nonsense"],
    ["GLOBAL_TRANSLATIONS_PER_DAY", "0"],
  ])("fails fast on %s=%s, naming the variable", (name, value) => {
    expect(() => readConfig({ ...MOCK_ENV, [name]: value })).toThrow(name);
  });
});

describe("the configuration schema", () => {
  it("names every variable once, in upper snake case, with a description", () => {
    const names = CONFIG_VARIABLES.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    for (const v of CONFIG_VARIABLES) {
      expect(v.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(v.description.length).toBeGreaterThan(10);
    }
  });

  it("its numeric defaults are the values the code falls back to", () => {
    for (const [name, value] of Object.entries(ENV_DEFAULTS)) {
      const variable = CONFIG_VARIABLES.find((v) => v.name === name);
      if (variable !== undefined) expect(variable.default).toBe(String(value));
    }
  });

  it("configDefault refuses a name outside the schema", () => {
    expect(() => configDefault("NOT_A_VARIABLE")).toThrow("NOT_A_VARIABLE");
  });
});
