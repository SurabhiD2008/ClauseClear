import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "@clauseclear/shared";
import { createApp } from "./app.js";
import { readLlmConfig } from "./llm/config.js";
import { logger } from "./logger.js";
import { checkProviders } from "./startup.js";
import { warmPdfWorker } from "./pipeline/pdfWorker.js";

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const isProduction = process.env.NODE_ENV === "production";
// Same relative path from server/src (tsx) and server/dist (node).
const clientDist = isProduction
  ? fileURLToPath(new URL("../../client/dist", import.meta.url))
  : undefined;

// Test only (prompt 16): the oddity guard's broken pages, for its self-tests.
const guardPagesDir =
  process.env.E2E_GUARD_PAGES === "1"
    ? fileURLToPath(new URL("../../client/e2e/guard-pages", import.meta.url))
    : undefined;

let app: ReturnType<typeof createApp>;
try {
  // Refuse to start without a usable provider unless the mode is mock (A181).
  // Skipped providers are logged by createLlmRouter inside createApp.
  const check = checkProviders(readLlmConfig(process.env));
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
  // For example an invalid sample file (A98): refuse to start rather than serve it.
  console.error(
    `ClauseClear server not started: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

// The first upload should not wait for a worker to load pdfjs (A175).
warmPdfWorker();

app.listen(port, () => {
  console.log(
    `ClauseClear server listening on port ${String(port)} (${isProduction ? "production" : "development"})`,
  );
});
