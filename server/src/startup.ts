// Startup checks (prompt 20, A181). The server refuses to start when no LLM
// provider is usable, unless the configured mode is the mock: a deployment with
// its keys missing would otherwise come up healthy and fail every analysis.
// The report names each provider and its model, never a key.
import type { LlmConfig } from "./llm/config.js";

export interface ProviderSummary {
  name: string;
  model: string;
  rpm: number;
  rpdBudget: number;
}

export type StartupCheck =
  | { ok: true; mock: boolean; active: ProviderSummary[]; skipped: LlmConfig["skipped"] }
  | { ok: false; message: string; skipped: LlmConfig["skipped"] };

export function checkProviders(config: Pick<LlmConfig, "providers" | "skipped">): StartupCheck {
  const active = config.providers.map(({ name, model, rpm, rpdBudget }) => ({
    name,
    model,
    rpm,
    rpdBudget,
  }));
  if (active.length === 0) {
    const missing = config.skipped.map((s) => `${s.name} (missing ${s.missing})`).join("; ");
    return {
      ok: false,
      message:
        "no LLM provider is configured. Set GEMINI_API_KEY and GEMINI_MODEL, or NVIDIA_API_KEY and NVIDIA_MODEL" +
        (missing === "" ? "" : `; skipped: ${missing}`) +
        ". Use LLM_PROVIDER_ORDER=mock only for a demo without AI.",
      skipped: config.skipped,
    };
  }
  return {
    ok: true,
    mock: config.providers.some((p) => p.kind === "mock"),
    active,
    skipped: config.skipped,
  };
}
