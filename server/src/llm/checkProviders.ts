// npm run check:providers (SPEC section 5 rule 1). For each configured provider:
// list the models the key can see, print candidates, send one tiny request, and
// print its status and any rate-limit headers. Every line passes through
// redact() first, so a key can never be printed even if an API echoed it.
import { buildProvider, readLlmConfig, type Env } from "./config.js";
import { listGeminiModels } from "./gemini.js";
import type { FetchLike } from "./http.js";
import { listOpenAiCompatibleModels } from "./openai-compatible.js";
import { LlmError, type ResponseMeta } from "./provider.js";

const MAX_LISTED = 40;
/** Thinking models count reasoning toward this limit, so it is not tiny. */
const CHECK_MAX_OUTPUT_TOKENS = 256;
const CANDIDATE_PATTERN = /instruct|chat|-it\b|gemini|flash/i;
const RATE_HEADER_PATTERN = /ratelimit|rate-limit|retry-after/i;

export interface CheckOptions {
  fetch?: FetchLike;
  print: (line: string) => void;
  now?: () => number;
}

/** Replaces every secret (and any 8+ character run of it) with [redacted]. */
export function redact(line: string, secrets: string[]): string {
  let out = line;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function rateHeaders(headers: Headers | undefined): string[] {
  if (headers === undefined) return [];
  const lines: string[] = [];
  headers.forEach((value, name) => {
    if (RATE_HEADER_PATTERN.test(name)) lines.push(`${name}: ${value}`);
  });
  return lines.sort();
}

/** Returns true when every configured provider answered the test request. */
export async function checkProviders(env: Env, options: CheckOptions): Promise<boolean> {
  const config = readLlmConfig(env);
  const secrets = config.providers.map((p) => p.apiKey).filter((key) => key !== "");
  const print = (line: string) => {
    options.print(redact(line, secrets));
  };
  const now = options.now ?? Date.now;
  const fetchOption = options.fetch === undefined ? {} : { fetch: options.fetch };

  for (const { name, missing } of config.skipped) {
    print(`- ${name}: skipped, missing ${missing}`);
  }
  const real = config.providers.filter((p) => p.kind !== "mock");
  if (real.length === 0 && config.providers.length > 0) {
    // LLM_PROVIDER_ORDER names only the mock: a deliberate demo setup, not an error (A182).
    print(
      "Mock mode (LLM_PROVIDER_ORDER names only the mock): no real provider to check. Analyses will be made up; the samples are real. Add a key and model in .env for real analyses.",
    );
    return true;
  }
  if (real.length === 0) {
    print("No provider is configured. Set a key and model in .env (see .env.example).");
    return false;
  }

  let allOk = true;
  for (const provider of real) {
    print("");
    print(
      `== ${provider.name} (${provider.kind === "gemini" ? "Gemini" : "OpenAI-compatible"}) ==`,
    );
    print(`base URL: ${provider.baseUrl}`);

    try {
      const listOptions = {
        name: provider.name,
        apiKey: provider.apiKey,
        model: provider.model,
        baseUrl: provider.baseUrl,
        ...fetchOption,
      };
      const models =
        provider.kind === "gemini"
          ? await listGeminiModels(listOptions)
          : await listOpenAiCompatibleModels(listOptions);
      const candidates = models.filter((id) => CANDIDATE_PATTERN.test(id)).sort();
      print(
        `models visible to this key: ${String(models.length)}; candidates: ${String(candidates.length)}`,
      );
      for (const id of candidates.slice(0, MAX_LISTED)) {
        print(`  ${id === provider.model.replace(/^models\//, "") ? "*" : " "} ${id}`);
      }
      if (candidates.length > MAX_LISTED) {
        print(`    ... and ${String(candidates.length - MAX_LISTED)} more`);
      }
      if (!models.includes(provider.model.replace(/^models\//, ""))) {
        print(`  ! configured model ${provider.model} is not in the list`);
      }
    } catch (error) {
      print(`model list failed: ${describe(error)}`);
    }

    let meta: ResponseMeta | undefined;
    const client = buildProvider(provider, config, {
      ...fetchOption,
      onResponse: (_name, response) => {
        meta = response;
      },
    });
    const started = now();
    try {
      const result = await client.generateJson({
        system: "You answer service health checks.",
        user: 'Return exactly this JSON: {"ok": true}',
        schemaName: "check",
        maxOutputTokens: CHECK_MAX_OUTPUT_TOKENS,
      });
      print(
        `test request (${provider.model}): ok, HTTP ${String(meta?.status ?? 200)}, ${String(now() - started)} ms, ${String(result.text.length)} chars back`,
      );
    } catch (error) {
      allOk = false;
      print(`test request (${provider.model}): FAILED, ${describe(error)}`);
    }
    const headers = rateHeaders(meta?.headers);
    print(headers.length === 0 ? "rate-limit headers: none sent" : "rate-limit headers:");
    for (const line of headers) print(`  ${line}`);
  }
  return allOk;
}

function describe(error: unknown): string {
  if (error instanceof LlmError) {
    return `${error.kind}${error.httpStatus === undefined ? "" : ` (HTTP ${String(error.httpStatus)})`}`;
  }
  return error instanceof Error ? error.name : "unknown error";
}
