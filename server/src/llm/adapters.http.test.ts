// Gemini and OpenAI-compatible adapters against a local fake HTTP server (no
// network). Real timers: these tests are about what goes over the wire.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createGeminiProvider } from "./gemini.js";
import { parseRetryAfter } from "./http.js";
import { zodOutput } from "./json.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import { type LlmProvider } from "./provider.js";
import { LlmRouter, LlmRouterError, type LlmLogEntry } from "./router.js";
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

describe("Retry-After parsing", () => {
  it("reads delta-seconds and HTTP dates, and ignores junk", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    expect(parseRetryAfter("12", now)).toBe(12_000);
    expect(parseRetryAfter("Mon, 02 Nov 2026 10:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe("router over real HTTP", () => {
  const output = zodOutput(z.strictObject({ ok: z.literal(true) }));

  function router(providers: LlmProvider[], timeoutMs = 45_000) {
    const logs: LlmLogEntry[] = [];
    const instance = new LlmRouter({
      providers: providers.map((provider) => ({ provider, rpm: 100, rpdBudget: 100 })),
      concurrency: 2,
      timeoutMs,
      budgetMs: 100_000,
      log: (entry) => logs.push(entry),
    });
    return { instance, logs };
  }

  it("falls back from a rate-limited Gemini to NVIDIA", async () => {
    server.reply(
      { status: 429, headers: { "retry-after": "30" }, body: {} },
      { body: chatAnswer('{"ok":true}') },
    );
    const { instance } = router([gemini(), nvidia()]);
    const result = await instance.generate(request, output);
    expect(result.provider).toBe("nvidia");
    expect(server.requests.map((r) => r.url)).toEqual([
      "/v1beta/models/gemini-test-model:generateContent",
      "/v1/chat/completions",
    ]);
  });

  it("times out a provider that never answers and closes the connection", async () => {
    server.reply({ hang: true });
    const { instance, logs } = router([gemini()], 150);
    // A short deadline: the 2 s retry would land past it, so the router stops.
    const error = await rejection(
      instance.generate(request, output, { deadline: Date.now() + 1_000 }),
    );
    expect(error).toBeInstanceOf(LlmRouterError);
    expect((error as LlmRouterError).code).toBe("PROVIDER_UNAVAILABLE");
    expect(logs.find((entry) => entry.event === "llm_call")).toMatchObject({ outcome: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.closedConnections()).toBeGreaterThan(0);
  });

  it("abort mid-call stops the HTTP request and rejects with AbortError", async () => {
    server.reply({ hang: true });
    const { instance } = router([gemini()]);
    const controller = new AbortController();
    const pending = rejection(instance.generate(request, output, { signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    expect((await pending).name).toBe("AbortError");
  });

  it("keys never appear in error messages or logs, even when the server echoes them", async () => {
    const echo = (status: number) => () => ({
      status,
      body: { error: `bad key ${GEMINI_KEY} ${NVIDIA_KEY}`, received: GEMINI_KEY },
    });
    const seen: string[] = [];
    for (const status of [401, 403, 429, 500, 400]) {
      server.reply(echo(status), echo(status));
      const { instance, logs } = router([gemini(), nvidia()], 2_000);
      const error = await rejection(
        instance.generate(request, output, { deadline: Date.now() + 2_000 }),
      );
      seen.push(String(error), error.message, error.stack ?? "", JSON.stringify(logs));
      for (const provider of [gemini(), nvidia()]) {
        const direct = await rejection(provider.generateJson(request));
        seen.push(String(direct), direct.message, direct.stack ?? "", JSON.stringify(direct));
      }
    }
    // A 200 whose output echoes the key is also never logged.
    server.reply({ body: geminiAnswer(`{"ok":true,"leak":"${GEMINI_KEY}"}`) });
    const { instance, logs } = router([gemini()]);
    await rejection(instance.generate(request, output));
    seen.push(JSON.stringify(logs));

    const everything = seen.join("\n");
    expect(everything).not.toContain(GEMINI_KEY);
    expect(everything).not.toContain(NVIDIA_KEY);
    expect(everything).not.toContain("document text");
  });
});
