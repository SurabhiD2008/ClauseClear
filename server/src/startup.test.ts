import { describe, expect, it } from "vitest";
import { readLlmConfig } from "./llm/config.js";
import { checkProviders } from "./startup.js";

const FAKE = "not-a-real-key-startup-test-0123456789";

describe("checkProviders (prompt 20, A181)", () => {
  it("refuses when no provider is configured and the mode is not mock", () => {
    const check = checkProviders(readLlmConfig({ LLM_PROVIDER_ORDER: "gemini,nvidia" }));
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toMatch(/no LLM provider is configured/);
    expect(check.message).toMatch(/gemini \(missing GEMINI_API_KEY, GEMINI_MODEL\)/);
    expect(check.message).toMatch(/nvidia \(missing NVIDIA_API_KEY, NVIDIA_MODEL\)/);
  });

  it("refuses with the default order and an empty environment", () => {
    expect(checkProviders(readLlmConfig({})).ok).toBe(false);
  });

  it("starts in mock mode with no keys", () => {
    const check = checkProviders(readLlmConfig({ LLM_PROVIDER_ORDER: "mock" }));
    expect(check).toMatchObject({ ok: true, mock: true, active: [{ name: "mock" }] });
  });

  it("starts with one real provider and reports the other as skipped", () => {
    const check = checkProviders(
      readLlmConfig({
        LLM_PROVIDER_ORDER: "gemini,nvidia",
        GEMINI_API_KEY: FAKE,
        GEMINI_MODEL: "gemini-test-model",
      }),
    );
    expect(check).toMatchObject({
      ok: true,
      mock: false,
      active: [{ name: "gemini", model: "gemini-test-model" }],
      skipped: [{ name: "nvidia" }],
    });
  });

  it("never carries a key, whatever the outcome", () => {
    const env = {
      LLM_PROVIDER_ORDER: "gemini,nvidia",
      GEMINI_API_KEY: FAKE,
      GEMINI_MODEL: "m",
      NVIDIA_API_KEY: FAKE,
    };
    expect(JSON.stringify(checkProviders(readLlmConfig(env)))).not.toContain(FAKE);
    const refused = { LLM_PROVIDER_ORDER: "nvidia", NVIDIA_API_KEY: FAKE };
    expect(JSON.stringify(checkProviders(readLlmConfig(refused)))).not.toContain(FAKE);
  });
});
