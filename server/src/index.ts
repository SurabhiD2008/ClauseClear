import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { readConfig, type AppConfig } from "./config.js";
import { logger } from "./logger.js";
import { checkProviders } from "./startup.js";
import { warmPdfWorker } from "./pipeline/pdfWorker.js";

let config: AppConfig;
try {
  config = readConfig(process.env);
} catch (error) {
  logger.fatal(
    `ClauseClear server not started: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
const { port } = config.server;
const isProduction = config.server.nodeEnv === "production";
// Same relative path from server/src (tsx) and server/dist (node).
const clientDist = isProduction
  ? fileURLToPath(new URL("../../client/dist", import.meta.url))
  : undefined;

// Test only: the oddity guard's broken pages, for its self-tests.
const guardPagesDir = config.server.guardPages
  ? fileURLToPath(new URL("../../client/e2e/guard-pages", import.meta.url))
  : undefined;

let app: ReturnType<typeof createApp>;
try {
  // Refuse to start without a usable provider unless the mode is mock.
  // Skipped providers are logged by createLlmRouter inside createApp.
  const check = checkProviders(config.llm);
  if (!check.ok) throw new Error(check.message);
  logger.info(
    { providers: check.active, mock: check.mock },
    check.mock
      ? "LLM providers active: mock only, so analyses are made up (demo mode)"
      : `LLM providers active: ${check.active.map((p) => p.name).join(", ")}`,
  );
  app = createApp({
    ...(clientDist === undefined ? {} : { clientDist }),
    ...(guardPagesDir === undefined ? {} : { guardPagesDir }),
  });
} catch (error) {
  // For example an invalid sample file: refuse to start rather than serve it.
  logger.fatal(
    `ClauseClear server not started: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

// The first upload should not wait for a worker to load pdfjs.
warmPdfWorker();

app.listen(port, () => {
  logger.info(
    { port, mode: isProduction ? "production" : "development" },
    `ClauseClear server listening on port ${String(port)}`,
  );
});
