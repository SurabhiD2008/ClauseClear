// HTTP-level settings from env (SPEC section 5): the abuse limits and the
// proxy setting. LLM settings are read by llm/config.ts.
import { ENV_DEFAULTS } from "@clauseclear/shared";
import type { Env } from "./llm/config.js";

export interface LimitsConfig {
  /** Analyses per IP per IP_WINDOW_MS. */
  ipAnalyses: number;
  /** Analyses across the server per day (midnight Pacific, like the provider quotas). */
  dailyAnalyses: number;
}

export interface ServerConfig {
  limits: LimitsConfig;
  /** Express "trust proxy": hops in front of the app whose X-Forwarded-For is believed. */
  trustProxy: number;
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

export function readServerConfig(env: Env): ServerConfig {
  return {
    limits: {
      ipAnalyses: count(env, "IP_ANALYSES_PER_10_MIN", ENV_DEFAULTS.IP_ANALYSES_PER_10_MIN, 1),
      dailyAnalyses: count(env, "GLOBAL_ANALYSES_PER_DAY", ENV_DEFAULTS.GLOBAL_ANALYSES_PER_DAY, 1),
    },
    trustProxy: count(env, "TRUST_PROXY", 0, 0),
  };
}
