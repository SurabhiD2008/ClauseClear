// The one configuration module. readConfig validates every environment value
// at startup and throws a message naming the variable at fault; the list of
// variables, with defaults, is the schema in configSchema.ts.
import { DEFAULT_PORT, ENV_DEFAULTS } from "@clauseclear/shared";
import { readLlmConfig, type Env, type LlmConfig } from "./llm/config.js";

export type { Env } from "./llm/config.js";
export { CONFIG_VARIABLES, configDefault, type ConfigVariable } from "./configSchema.js";

export interface LimitsConfig {
  /** Analyses per IP per IP_WINDOW_MS. */
  ipAnalyses: number;
  /** Analyses across the server per day (midnight Pacific, like the provider quotas). */
  dailyAnalyses: number;
  /** Translation requests across the server per day, counted apart from analyses. */
  dailyTranslations: number;
}

export interface ServerConfig {
  limits: LimitsConfig;
  /** Express "trust proxy": hops in front of the app whose X-Forwarded-For is believed. */
  trustProxy: number;
  port: number;
  nodeEnv: string;
  /** Serve the browser guard's self-test pages (end-to-end tests only). */
  guardPages: boolean;
}

function count(env: Env, key: string, fallback: number, min: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be an integer of at least ${String(min)}`);
  }
  return value;
}

/** NODE_ENV, or "development" when unset. Safe to call before full validation. */
export function nodeEnvOf(env: Env): string {
  const value = env.NODE_ENV?.trim();
  return value === undefined || value === "" ? "development" : value;
}

export function readServerConfig(env: Env): ServerConfig {
  return {
    limits: {
      ipAnalyses: count(env, "IP_ANALYSES_PER_10_MIN", ENV_DEFAULTS.IP_ANALYSES_PER_10_MIN, 1),
      dailyAnalyses: count(env, "GLOBAL_ANALYSES_PER_DAY", ENV_DEFAULTS.GLOBAL_ANALYSES_PER_DAY, 1),
      dailyTranslations: count(
        env,
        "GLOBAL_TRANSLATIONS_PER_DAY",
        ENV_DEFAULTS.GLOBAL_TRANSLATIONS_PER_DAY,
        1,
      ),
    },
    trustProxy: count(env, "TRUST_PROXY", 0, 0),
    port: count(env, "PORT", DEFAULT_PORT, 1),
    nodeEnv: nodeEnvOf(env),
    guardPages: env.E2E_GUARD_PAGES === "1",
  };
}

export interface AppConfig {
  server: ServerConfig;
  llm: LlmConfig;
}

/** Reads and validates every setting at once; throws naming the first bad variable. */
export function readConfig(env: Env): AppConfig {
  return { server: readServerConfig(env), llm: readLlmConfig(env) };
}
