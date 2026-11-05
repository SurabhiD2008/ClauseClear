// npm run check:providers: reads .env if present, then checks every configured
// provider. Makes real network calls with real keys, so it is never part of
// npm test or the audit. It never prints a key.
import { existsSync } from "node:fs";
import { checkProviders } from "../server/src/llm/checkProviders.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const ok = await checkProviders(process.env, {
  print: (line) => {
    console.log(line);
  },
});
process.exitCode = ok ? 0 : 1;
