// `npm start` (prompts 20 and 21, A181, A182): the production entry.
// - Loads the repository's .env when there is one, as check:providers does, so a
//   clean clone runs with `cp .env.example .env` and `npm start`. Variables already
//   in the environment win (Node's loadEnvFile never overwrites them), so a host's
//   dashboard values and the e2e servers' settings are unchanged; hosts have no .env.
// - Defaults NODE_ENV to production, so a host serves the API and the built client
//   without being told; an explicit value is kept.
// The import is dynamic so that every module, the logger included, sees the values.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.NODE_ENV ??= "production";
await import("./index.js");
