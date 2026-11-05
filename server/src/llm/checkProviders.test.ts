// check:providers against a local fake server. Proves the output lists models,
// reports status and rate-limit headers, and never prints a key.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkProviders, redact } from "./checkProviders.js";
import { startFakeHttpServer, type FakeHttpServer } from "./testing/fakeHttp.js";

const GEMINI_KEY = "fake-check-gemini-key-0123456789";
const NVIDIA_KEY = "fake-check-nvidia-key-0123456789";

let server: FakeHttpServer;
beforeAll(async () => {
  server = await startFakeHttpServer();
});
afterAll(async () => {
  await server.close();
});

function env() {
  return {
    LLM_PROVIDER_ORDER: "gemini,nvidia",
    GEMINI_API_KEY: GEMINI_KEY,
    GEMINI_MODEL: "gemini-fake-flash",
    GEMINI_BASE_URL: `${server.baseUrl}/v1beta`,
    NVIDIA_API_KEY: NVIDIA_KEY,
    NVIDIA_MODEL: "vendor/fake-instruct",
    NVIDIA_BASE_URL: `${server.baseUrl}/v1`,
  };
}

async function run(): Promise<{ ok: boolean; output: string }> {
  const lines: string[] = [];
  const ok = await checkProviders(env(), { print: (line) => lines.push(line), now: () => 0 });
  return { ok, output: lines.join("\n") };
}

describe("check:providers", () => {
  it("lists models, sends one tiny request each and prints rate-limit headers", async () => {
    server.reply(
      {
        body: {
          models: [
            { name: "models/gemini-fake-flash", supportedGenerationMethods: ["generateContent"] },
          ],
        },
      },
      {
        headers: { "x-ratelimit-remaining-requests": "7" },
        body: {
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }],
        },
      },
      { body: { data: [{ id: "vendor/fake-instruct" }, { id: "vendor/embed" }] } },
      {
        headers: { "retry-after": "0" },
        body: { choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] },
      },
    );
    const { ok, output } = await run();
    expect(ok).toBe(true);
    expect(output).toContain("== gemini (Gemini) ==");
    expect(output).toContain("* gemini-fake-flash");
    expect(output).toContain("test request (gemini-fake-flash): ok, HTTP 200");
    expect(output).toContain("x-ratelimit-remaining-requests: 7");
    expect(output).toContain("== nvidia (OpenAI-compatible) ==");
    expect(output).toContain("* vendor/fake-instruct");
    expect(output).toContain("retry-after: 0");
  });

  it("reports failures without printing a key, even when the API echoes it", async () => {
    const echo = { status: 401, body: { error: `invalid key ${GEMINI_KEY} ${NVIDIA_KEY}` } };
    server.reply(
      {
        body: {
          models: [
            { name: `models/${GEMINI_KEY}`, supportedGenerationMethods: ["generateContent"] },
          ],
        },
      },
      echo,
      { body: { data: [{ id: `echo-${NVIDIA_KEY}-instruct` }] } },
      { status: 429, headers: { "retry-after": "12" }, body: {} },
    );
    const { ok, output } = await run();
    expect(ok).toBe(false);
    expect(output).toContain("FAILED, auth (HTTP 401)");
    expect(output).toContain("FAILED, rate_limit (HTTP 429)");
    expect(output).toContain("retry-after: 12");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain(GEMINI_KEY);
    expect(output).not.toContain(NVIDIA_KEY);
  });

  it("with no provider configured, says so and fails", async () => {
    const lines: string[] = [];
    const ok = await checkProviders(
      { LLM_PROVIDER_ORDER: "gemini" },
      { print: (l) => lines.push(l) },
    );
    expect(ok).toBe(false);
    expect(lines.join("\n")).toContain("gemini: skipped, missing GEMINI_API_KEY, GEMINI_MODEL");
  });

  it("in mock mode, says there is nothing real to check and passes (A182)", async () => {
    const lines: string[] = [];
    const ok = await checkProviders(
      { LLM_PROVIDER_ORDER: "mock" },
      { print: (l) => lines.push(l) },
    );
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/^Mock mode/m);
  });

  it("redact removes every configured secret", () => {
    expect(redact("a SECRET-12345 b SECRET-12345", ["SECRET-12345"])).toBe(
      "a [redacted] b [redacted]",
    );
  });
});
