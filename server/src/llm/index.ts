import { logger } from "../logger.js";
import { createRouterFromConfig, readLlmConfig, type Env } from "./config.js";
import type { LlmRouter } from "./router.js";

export { readLlmConfig, createRouterFromConfig } from "./config.js";
export { zodOutput, type OutputSpec } from "./json.js";
export { LlmRouterError, type LlmRouter, type RouterRequest } from "./router.js";
export { MOCK_SCENARIO_HEADER, runWithMockScenario, scenarioFromHeader } from "./mock.js";
export * from "./provider.js";

/** The server's router: providers from env, call logs to pino. Logs names, never keys. */
export function createLlmRouter(env: Env = process.env): LlmRouter {
  const config = readLlmConfig(env);
  for (const { name, missing } of config.skipped) {
    logger.warn({ provider: name, missing }, "LLM provider skipped: missing settings");
  }
  return createRouterFromConfig(config, (entry) => {
    logger.info(entry);
  });
}
