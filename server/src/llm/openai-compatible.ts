// OpenAI-compatible chat completions: NVIDIA NIM and any extra endpoint named in
// LLM_PROVIDER_ORDER (base URL, key and model from env; ASSUMPTIONS A50, A55).
// NVIDIA documents no response_format field, so JSON is asked for in the prompt
// and the router strips code fences and validates with zod.
import { asArray, asNumber, asRecord, requestJson, trimSlash, type FetchLike } from "./http.js";
import {
  BadOutputError,
  resultWithUsage,
  type GenerateJsonRequest,
  type GenerateJsonResult,
  type LlmProvider,
  type ResponseMeta,
} from "./provider.js";

export interface OpenAiCompatibleOptions {
  name: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  fetch?: FetchLike;
  onResponse?: (meta: ResponseMeta) => void;
}

/** Appended to the system prompt: the only JSON control these endpoints are guaranteed to honour. */
export const JSON_ONLY_INSTRUCTION =
  "Reply with one JSON value only. No code fences, no text before or after it.";

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const { name } = options;
  const fetchImpl = options.fetch ?? fetch;
  const url = `${trimSlash(options.baseUrl)}/chat/completions`;

  return {
    name,
    model: options.model,
    async generateJson(request: GenerateJsonRequest): Promise<GenerateJsonResult> {
      const body = {
        model: options.model,
        messages: [
          { role: "system", content: `${request.system}\n\n${JSON_ONLY_INSTRUCTION}` },
          { role: "user", content: request.user },
        ],
        max_tokens: request.maxOutputTokens,
        stream: false,
      };
      const data = asRecord(
        await requestJson({
          provider: name,
          fetch: fetchImpl,
          url,
          headers: { authorization: `Bearer ${options.apiKey}` },
          body,
          signal: request.signal,
          onResponse: options.onResponse,
        }),
      );
      if (data === undefined) throw new BadOutputError(name, "body");
      return parseChatCompletion(name, data);
    },
  };
}

export function parseChatCompletion(
  name: string,
  data: Record<string, unknown>,
): GenerateJsonResult {
  const choice = asRecord(asArray(data.choices)[0]);
  if (choice === undefined) throw new BadOutputError(name, "empty");
  if (choice.finish_reason === "length") throw new BadOutputError(name, "truncated");

  const content = asRecord(choice.message)?.content;
  if (typeof content !== "string" || content.trim() === "") throw new BadOutputError(name, "empty");

  const usage = asRecord(data.usage);
  return resultWithUsage(
    content,
    asNumber(usage?.prompt_tokens),
    asNumber(usage?.completion_tokens),
  );
}

/** GET {base}/models for check:providers. NVIDIA returns OpenAI's list shape: data[].id. */
export async function listOpenAiCompatibleModels(
  options: OpenAiCompatibleOptions,
): Promise<string[]> {
  const data = asRecord(
    await requestJson({
      provider: options.name,
      fetch: options.fetch ?? fetch,
      url: `${trimSlash(options.baseUrl)}/models`,
      headers: { authorization: `Bearer ${options.apiKey}` },
      onResponse: options.onResponse,
    }),
  );
  return asArray(data?.data)
    .map((model) => asRecord(model)?.id)
    .filter((id): id is string => typeof id === "string");
}
