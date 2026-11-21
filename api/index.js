// Vercel entry. Vercel serves the built client (client/dist) from its CDN
// and sends every /api/* request here (vercel.json rewrites), where the same
// Express app as `npm start` answers it; req.url keeps the original path.
// It imports the compiled server, so `npm run build` must run first (Vercel's
// build command does). Like `npm start`, it refuses to start without a usable
// provider unless the mode is mock, and logs the active providers, never keys.
import { createApp } from "../server/dist/app.js";
import { readConfig } from "../server/dist/config.js";
import { logger } from "../server/dist/logger.js";
import { checkProviders } from "../server/dist/startup.js";

// Every variable is validated here, so a bad value stops the function with a
// message naming it instead of failing later on a request.
const check = checkProviders(readConfig(process.env).llm);
if (!check.ok) throw new Error(`ClauseClear API not started: ${check.message}`);
logger.info(
  { providers: check.active, mock: check.mock },
  check.mock
    ? "LLM providers active: mock only, so analyses are made up (demo mode)"
    : `LLM providers active: ${check.active.map((p) => p.name).join(", ")}`,
);

export default createApp();
