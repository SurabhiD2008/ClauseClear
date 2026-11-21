// Gemini and OpenAI-compatible adapters against a local fake HTTP server (no
// network). Real timers: these tests are about what goes over the wire.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGeminiProvider, listGeminiModels } from "./gemini.js";
import {
  JSON_ONLY_INSTRUCTION,
  createOpenAiCompatibleProvider,
  listOpenAiCompatibleModels,
} from "./openai-compatible.js";
import {
  AuthError,
  BadOutputError,
  RateLimitError,
  RequestError,
  TransientError,
} from "./provider.js";
import { startFakeHttpServer, type FakeHttpServer } from "./testing/fakeHttp.js";

// Fake keys, deliberately not key-shaped so the secret scan has nothing to flag.
// The tests prove they are sent only where they belong.
const GEMINI_KEY = "fake-gemini-test-key-0123456789abcdef";
const NVIDIA_KEY = "fake-nvidia-test-key-0123456789abcdef";
const request = {
  system: "rules",
  user: "document text",
  schemaName: "test",
  maxOutputTokens: 300,
};

let server: FakeHttpServer;
beforeAll(async () => {
  server = await startFakeHttpServer();
});
afterAll(async () => {
  await server.close();
});
afterEach(() => {
  server.requests.length = 0;
});

const gemini = (model = "gemini-test-model") =>
  createGeminiProvider({ apiKey: GEMINI_KEY, model, baseUrl: `${server.baseUrl}/v1beta` });
const nvidia = () =>
  createOpenAiCompatibleProvider({
    name: "nvidia",
    apiKey: NVIDIA_KEY,
    model: "vendor/test-instruct",
    baseUrl: `${server.baseUrl}/v1/`,
  });

const geminiAnswer = (text: string, finishReason = "STOP") => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 },
});
const chatAnswer = (content: string, finishReason = "stop") => ({
  id: "1",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

describe("Gemini adapter", () => {
  it("sends the key in x-goog-api-key, never in the URL, with JSON mode and the token cap", async () => {
    server.reply({ body: geminiAnswer('{"ok":true}') });
    const result = await gemini("models/gemini-test-model").generateJson(request);

    expect(result).toEqual({ text: '{"ok":true}', usage: { inputTokens: 12, outputTokens: 5 } });
    const sent = server.requests[0];
    expect(sent?.method).toBe("POST");
    expect(sent?.url).toBe("/v1beta/models/gemini-test-model:generateContent");
    expect(sent?.url).not.toContain(GEMINI_KEY);
    expect(sent?.headers["x-goog-api-key"]).toBe(GEMINI_KEY);
    expect(sent?.body).toEqual({
      systemInstruction: { parts: [{ text: "rules" }] },
      contents: [{ role: "user", parts: [{ text: "document text" }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 300 },
    });
  });

  it("sends thinkingConfig.thinkingLevel only when configured, and reports thinking tokens", async () => {
    server.reply({
      body: {
        ...geminiAnswer('{"ok":true}'),
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 40 },
      },
    });
    const thinking = createGeminiProvider({
      apiKey: GEMINI_KEY,
      model: "gemini-test-model",
      baseUrl: `${server.baseUrl}/v1beta`,
      thinkingLevel: "LOW",
    });
    const result = await thinking.generateJson(request);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5, thinkingTokens: 40 });
    expect((server.requests[0]?.body as { generationConfig: unknown }).generationConfig).toEqual({
      responseMimeType: "application/json",
      maxOutputTokens: 300,
      thinkingConfig: { thinkingLevel: "LOW" },
    });
  });

  it("429 with Retry-After seconds becomes RateLimitError with retryAfterMs", async () => {
    server.reply({ status: 429, headers: { "retry-after": "7" }, body: { error: { code: 429 } } });
    const error = await rejection(gemini().generateJson(request));
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(7_000);
  });

  it("429 without Retry-After becomes RateLimitError with no retryAfterMs", async () => {
    server.reply({ status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } });
    const error = await rejection(gemini().generateJson(request));
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBeUndefined();
  });

  it("maps 500 to TransientError, 401 and 403 to AuthError, 400 and 404 to RequestError", async () => {
    const cases = [
      [500, TransientError],
      [503, TransientError],
      [401, AuthError],
      [403, AuthError],
      [400, RequestError],
      [404, RequestError],
    ] as const;
    for (const [status, type] of cases) {
      server.reply({ status, body: { error: { message: "nope" } } });
      expect(await rejection(gemini().generateJson(request))).toBeInstanceOf(type);
    }
  });

  it("MAX_TOKENS is truncated output, a blocked prompt and empty candidates are unusable", async () => {
    const cases = [
      [geminiAnswer('{"ok":', "MAX_TOKENS"), "truncated"],
      [geminiAnswer("x", "SAFETY"), "blocked"],
      [{ promptFeedback: { blockReason: "SAFETY" } }, "blocked"],
      [{ candidates: [] }, "empty"],
      [geminiAnswer("   "), "empty"],
    ] as const;
    for (const [body, reason] of cases) {
      server.reply({ body });
      const error = await rejection(gemini().generateJson(request));
      expect(error).toBeInstanceOf(BadOutputError);
      expect((error as BadOutputError).reason).toBe(reason);
    }
  });

  it("a 200 with a body that is not JSON is BadOutputError", async () => {
    server.reply({ body: "<html>proxy error</html>" });
    const error = await rejection(gemini().generateJson(request));
    expect((error as BadOutputError).reason).toBe("body");
  });

  it("models.list follows nextPageToken and keeps only generateContent models", async () => {
    server.reply(
      {
        body: {
          models: [
            {
              name: "models/gemini-a",
              supportedGenerationMethods: ["generateContent", "countTokens"],
            },
            { name: "models/embedding-x", supportedGenerationMethods: ["embedContent"] },
          ],
          nextPageToken: "page-2",
        },
      },
      {
        body: {
          models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }],
        },
      },
    );
    const models = await listGeminiModels({
      apiKey: GEMINI_KEY,
      model: "x",
      baseUrl: `${server.baseUrl}/v1beta`,
    });
    expect(models).toEqual(["gemini-a", "gemini-b"]);
    expect(server.requests[1]?.url).toContain("pageToken=page-2");
    expect(server.requests.every((r) => !r.url.includes(GEMINI_KEY))).toBe(true);
  });
});

describe("OpenAI-compatible adapter (NVIDIA)", () => {
  it("sends Bearer auth, the model from env, max_tokens and a JSON-only system prompt", async () => {
    server.reply({ body: chatAnswer('```json\n{"ok":true}\n```') });
    const result = await nvidia().generateJson(request);

    expect(result.text).toBe('```json\n{"ok":true}\n```');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    const sent = server.requests[0];
    expect(sent?.url).toBe("/v1/chat/completions");
    expect(sent?.headers.authorization).toBe(`Bearer ${NVIDIA_KEY}`);
    expect(sent?.body).toEqual({
      model: "vendor/test-instruct",
      messages: [
        { role: "system", content: `rules\n\n${JSON_ONLY_INSTRUCTION}` },
        { role: "user", content: "document text" },
      ],
      max_tokens: 300,
      stream: false,
    });
  });

  it("finish_reason length is truncated output; 202 pending is transient", async () => {
    server.reply({ body: chatAnswer('{"ok":', "length") });
    expect(((await rejection(nvidia().generateJson(request))) as BadOutputError).reason).toBe(
      "truncated",
    );
    server.reply({ status: 202, body: {} });
    expect(await rejection(nvidia().generateJson(request))).toBeInstanceOf(TransientError);
  });

  it("lists models from GET /models", async () => {
    server.reply({ body: { object: "list", data: [{ id: "a/x-instruct" }, { id: "b/embed" }] } });
    const models = await listOpenAiCompatibleModels({
      name: "nvidia",
      apiKey: NVIDIA_KEY,
      model: "x",
      baseUrl: `${server.baseUrl}/v1`,
    });
    expect(models).toEqual(["a/x-instruct", "b/embed"]);
    expect(server.requests[0]?.method).toBe("GET");
  });

  it("a refused connection is a TransientError", async () => {
    const closed = createOpenAiCompatibleProvider({
      name: "nvidia",
      apiKey: NVIDIA_KEY,
      model: "m",
      baseUrl: "http://127.0.0.1:9",
    });
    expect(await rejection(closed.generateJson(request))).toBeInstanceOf(TransientError);
  });
});
