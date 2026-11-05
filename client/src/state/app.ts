// Wires the three stores (analysis, UI, language) and routes every event of
// the reset-and-keep table through applyStateRule, the one function that owns it.
import type { Lang } from "@clauseclear/shared";
import type { Api } from "../lib/api";
import { visibleFlags } from "../lib/flags";
import { startTranslator } from "../lib/translate";
import { createAnalysisStore, type AnalysisNotice, type AnalysisStore } from "./analysis";
import type { LanguageStore } from "./language";
import {
  applyStateRule,
  createUiStore,
  readTicks,
  writeTicks,
  type Filter,
  type StateRuleEvent,
  type TickStorage,
  type UiStore,
} from "./ui";

export interface AppStores {
  analysis: AnalysisStore;
  ui: UiStore;
  language: LanguageStore;
  dispatch: (event: StateRuleEvent) => void;
  setLanguage: (lang: Lang) => void;
  changeFilter: (filter: Filter) => void;
  /** Stops the translator; for tests. */
  dispose: () => void;
}

export interface AppDeps {
  api: Api;
  language: LanguageStore;
  tickStorage: TickStorage | null;
  newRunAnalysisId?: (runId: number) => string;
}

export function createAppStores(deps: AppDeps): AppStores {
  const { language, tickStorage } = deps;
  const ui = createUiStore(tickStorage);

  const dispatch = (event: StateRuleEvent) => {
    const before = {
      lang: language.getState().lang,
      run: analysis.getState().run,
      ui: ui.getState(),
    };
    const after = applyStateRule(before, event);
    if (after.run !== before.run) analysis.setRun(after.run);
    ui.replace(after.ui);
    // Every toggle reaches the language store, even when its lang has not changed
    // yet: a click on EN while Hindi is still loading must cancel that switch.
    if (event.type === "LANGUAGE_TOGGLED") void language.setLanguage(after.lang);
  };

  const onNotice = (notice: AnalysisNotice) => {
    if (notice.type === "RUN_CANCELLED") {
      dispatch(notice);
      return;
    }
    const { analysisId } = notice;
    // A fresh choice starts unticked, so stale stored ticks for that id go too.
    const ticks = notice.restoreTicks ? readTicks(tickStorage, analysisId) : [];
    if (!notice.restoreTicks) writeTicks(tickStorage, analysisId, []);
    dispatch({ type: "NEW_ANALYSIS", analysisId, ticks });
  };

  const analysis = createAnalysisStore({
    api: deps.api,
    emit: onNotice,
    ...(deps.newRunAnalysisId === undefined ? {} : { newRunAnalysisId: deps.newRunAnalysisId }),
  });

  const dispose = startTranslator({ api: deps.api, analysis, ui, language });

  return {
    analysis,
    ui,
    language,
    dispatch,
    setLanguage: (lang) => {
      dispatch({ type: "LANGUAGE_TOGGLED", lang });
    },
    changeFilter: (filter) => {
      const flags = analysis.getState().current?.result.flags ?? [];
      dispatch({
        type: "FILTER_CHANGED",
        filter,
        firstVisibleFlagId: visibleFlags(flags, filter)[0]?.id ?? null,
      });
    },
    dispose,
  };
}
