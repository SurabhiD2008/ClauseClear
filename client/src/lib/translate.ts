// Hindi for dynamic results (SPEC section 9, "Language toggle"). Samples use
// their precomputed Hindi; any other result is sent to /api/translate once and
// cached in the UI store. English stays on screen, with a "Translating…" line,
// until the Hindi arrives; on failure English stays and a notice says so.
// Switching back to English is instant and keeps the cache.
import {
  applyTranslations,
  extractTranslatable,
  type AnalysisResult,
  type Lang,
} from "@clauseclear/shared";
import type { AnalysisStore } from "../state/analysis";
import type { LanguageStore } from "../state/language";
import type { HindiCache, UiStore } from "../state/ui";
import type { Api } from "./api";

export interface TranslatorDeps {
  api: Pick<Api, "translate">;
  analysis: Pick<AnalysisStore, "getState" | "subscribe">;
  ui: Pick<UiStore, "getState" | "subscribe" | "setHindi">;
  language: Pick<LanguageStore, "getState" | "subscribe">;
}

/**
 * Keeps the Hindi cache in step with the language and the current result.
 * A failed translation is retried only when the user toggles to Hindi again,
 * so a broken service is not called in a loop. Returns a function that stops it.
 */
export function startTranslator(deps: TranslatorDeps): () => void {
  let inFlight: { analysisId: string; controller: AbortController } | null = null;
  let lastLang: Lang = deps.language.getState().lang;

  const sync = () => {
    const lang = deps.language.getState().lang;
    const toggledToHindi = lang === "hi" && lastLang !== "hi";
    lastLang = lang;
    const current = deps.analysis.getState().current;
    const ui = deps.ui.getState();

    // A translation for a result that is no longer on screen is abandoned.
    if (inFlight !== null && inFlight.analysisId !== current?.analysisId) {
      inFlight.controller.abort();
      inFlight = null;
    }
    if (lang !== "hi" || current === null) return;
    // The UI state still belongs to an older analysis until NEW_ANALYSIS lands.
    if (ui.analysisId !== current.analysisId) return;
    const { status } = ui.hindi;
    if (status === "ready" || status === "loading") return;
    if (status === "failed" && !toggledToHindi) return;

    const { analysisId } = current;
    if (current.source === "sample") {
      deps.ui.setHindi(analysisId, { status: "ready", strings: current.hi, unchanged: [] });
      return;
    }

    const controller = new AbortController();
    const request = { analysisId, controller };
    inFlight = request;
    deps.ui.setHindi(analysisId, { status: "loading", strings: null, unchanged: [] });
    deps.api.translate(extractTranslatable(current.result), controller.signal).then(
      (response) => {
        if (inFlight !== request) return;
        inFlight = null;
        deps.ui.setHindi(analysisId, {
          status: "ready",
          strings: response.strings,
          unchanged: response.unchanged,
        });
      },
      () => {
        if (inFlight !== request) return;
        inFlight = null;
        deps.ui.setHindi(analysisId, { status: "failed", strings: null, unchanged: [] });
      },
    );
  };

  const unsubscribe = [
    deps.language.subscribe(sync),
    deps.analysis.subscribe(sync),
    deps.ui.subscribe(sync),
  ];
  sync();
  return () => {
    for (const stop of unsubscribe) stop();
    inFlight?.controller.abort();
    inFlight = null;
  };
}

export interface ResultView {
  /** In Hindi when the cache is ready and the page is in Hindi, otherwise English. */
  result: AnalysisResult;
  translating: boolean;
  translateFailed: boolean;
}

/** What the results pages render. Quotes and segments are never in the cache, so they stay English. */
export function resultView(result: AnalysisResult, lang: Lang, hindi: HindiCache): ResultView {
  if (lang !== "hi") return { result, translating: false, translateFailed: false };
  if (hindi.status === "ready" && hindi.strings !== null) {
    return {
      result: applyTranslations(result, hindi.strings),
      translating: false,
      translateFailed: false,
    };
  }
  return {
    result,
    translating: hindi.status === "loading" || hindi.status === "idle",
    translateFailed: hindi.status === "failed",
  };
}
