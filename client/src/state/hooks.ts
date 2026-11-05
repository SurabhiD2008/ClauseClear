import { useMemo, useSyncExternalStore } from "react";
import { useLanguage } from "../i18n/useT";
import { resultView, type ResultView } from "../lib/translate";
import type { AnalysisStoreState } from "./analysis";
import { app } from "./instance";
import type { UiState } from "./ui";

export function useAnalysis(): AnalysisStoreState {
  return useSyncExternalStore(app.analysis.subscribe, app.analysis.getState);
}

export function useUi(): UiState {
  return useSyncExternalStore(app.ui.subscribe, app.ui.getState);
}

/** The current result as the page should show it, in the chosen language when available. */
export function useResultView(): ResultView | null {
  const { current } = useAnalysis();
  const { hindi } = useUi();
  const { lang } = useLanguage();
  return useMemo(
    () => (current === null ? null : resultView(current.result, lang, hindi)),
    [current, lang, hindi],
  );
}
