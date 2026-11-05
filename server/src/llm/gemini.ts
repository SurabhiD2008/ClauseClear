// Gemini over REST generateContent (field names confirmed Nov 2, 2026; see
// ASSUMPTIONS A49 and A51). The key travels in the x-goog-api-key header, never
// in the URL. JSON mode is requested with generationConfig.responseMimeType. No
// response schema is sent: the docs mark responseSchema deprecated in favour of
// a new responseFormat object, so the zod check in the router is the contract.
import { asArray, asNumber, asRecord, requestJson, trimSlash, type FetchLike } from "./http.js";
import {
  BadOutputError,
  resultWithUsage,
  type GenerateJsonRequest,
  type GenerateJsonResult,
  type LlmProvider,
  type ResponseMeta,
} from "./provider.js";

export interface GeminiOptions {
  name?: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  /** generationConfig.thinkingConfig.thinkingLevel; Gemini 3 and later only (A92). */
  thinkingLevel?: GeminiThinkingLevel;
  fetch?: FetchLike;
  onResponse?: (meta: ResponseMeta) => void;
}

export const GEMINI_THINKING_LEVELS = ["MINIMAL", "LOW", "MEDIUM", "HIGH"] as const;
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVELS)[number];

/** "models/gemini-x" and "gemini-x" both work; AI Studio shows either form. */
export function geminiModelPath(model: string): string {
  return `models/${encodeURIComponent(model.replace(/^models\//, ""))}`;
}

export function createGeminiProvider(options: GeminiOptions): LlmProvider {
  const name = options.name ?? "gemini";
  const fetchImpl = options.fetch ?? fetch;
  const url = `${trimSlash(options.baseUrl)}/${geminiModelPath(options.model)}:generateContent`;

  return {
    name,
    model: options.model,
    async generateJson(request: GenerateJsonRequest): Promise<GenerateJsonResult> {
      const body = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: request.maxOutputTokens,
          ...(options.thinkingLevel === undefined
            ? {}
            : { thinkingConfig: { thinkingLevel: options.thinkingLevel } }),
        },
      };
      const data = asRecord(
        await requestJson({
          provider: name,
          fetch: fetchImpl,
          url,
          headers: { "x-goog-api-key": options.apiKey },
          body,
          signal: request.signal,
          onResponse: options.onResponse,
        }),
      );
      if (data === undefined) throw new BadOutputError(name, "body");
      return parseGeminiResponse(name, data);
    },
  };
}

export function parseGeminiResponse(
  name: string,
  data: Record<string, unknown>,
): GenerateJsonResult {
  // A blocked prompt returns no candidates and sets promptFeedback.blockReason.
  if (asRecord(data.promptFeedback)?.blockReason !== undefined) {
    throw new BadOutputError(name, "blocked");
  }
  const candidate = asRecord(asArray(data.candidates)[0]);
  if (candidate === undefined) throw new BadOutputError(name, "empty");

  const finishReason = candidate.finishReason;
  if (finishReason === "MAX_TOKENS") throw new BadOutputError(name, "truncated");
  if (
    typeof finishReason === "string" &&
    finishReason !== "STOP" &&
    finishReason !== "FINISH_REASON_UNSPECIFIED"
  ) {
    // SAFETY, RECITATION, BLOCKLIST and the rest: the text cannot be trusted as complete.
    throw new BadOutputError(name, "blocked");
  }

  const text = asArray(asRecord(candidate.content)?.parts)
    .map((part) => asRecord(part)?.text)
    .filter((part): part is string => typeof part === "string")
    .join("");
  if (text.trim() === "") throw new BadOutputError(name, "empty");

  const usage = asRecord(data.usageMetadata);
  return resultWithUsage(
    text,
    asNumber(usage?.promptTokenCount),
    asNumber(usage?.candidatesTokenCount),
    asNumber(usage?.thoughtsTokenCount),
  );
}

/** models.list for check:providers: every model that supports generateContent. */
export async function listGeminiModels(options: GeminiOptions): Promise<string[]> {
  const name = options.name ?? "gemini";
  const fetchImpl = options.fetch ?? fetch;
  const found: string[] = [];
  let pageToken: string | undefined;
  // pageSize max is 1000; the loop is capped so a misbehaving API cannot spin forever.
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ pageSize: "1000" });
    if (pageToken !== undefined) query.set("pageToken", pageToken);
    const data = asRecord(
      await requestJson({
        provider: name,
        fetch: fetchImpl,
        url: `${trimSlash(options.baseUrl)}/models?${query.toString()}`,
        headers: { "x-goog-api-key": options.apiKey },
        onResponse: options.onResponse,
      }),
    );
    for (const model of asArray(data?.models)) {
      const record = asRecord(model);
      const methods = asArray(record?.supportedGenerationMethods);
      if (typeof record?.name === "string" && methods.includes("generateContent")) {
        found.push(record.name.replace(/^models\//, ""));
      }
    }
    const next = data?.nextPageToken;
    if (typeof next !== "string" || next === "") break;
    pageToken = next;
  }
  return found;
}
