// The UI store and the reset-and-keep table (SPEC section 9, "State rules").
// applyStateRule is the one function that owns the table: every row is an
// event, and it decides what each event resets across the run, the UI and the
// language. The stores only write what it returns (state/index.ts).
import {
  INITIAL_ANALYSIS_STATE,
  TICKS_STORAGE_PREFIX,
  transition,
  type AnalysisState,
  type Lang,
  type StatusEvent,
  type TranslationMap,
} from "@clauseclear/shared";

export const FILTERS = ["all", "high", "medium"] as const;
export type Filter = (typeof FILTERS)[number];

/** Hindi for one analysis, in memory only. Samples fill it from their fixture. */
export interface HindiCache {
  status: "idle" | "loading" | "ready" | "failed";
  strings: TranslationMap | null;
  /** Keys the server left in English (number check failed twice). */
  unchanged: string[];
}

export interface UiState {
  /** The analysis the rest of this state belongs to. */
  analysisId: string | null;
  selectedFlagId: string | null;
  filter: Filter;
  sheetOpen: boolean;
  /** Ticked checklist item ids, in tick order. */
  ticks: string[];
  hindi: HindiCache;
}

export interface RunSnapshot {
  machine: AnalysisState;
  progress: StatusEvent | null;
}

export interface AppSnapshot {
  lang: Lang;
  run: RunSnapshot;
  ui: UiState;
}

export const EMPTY_HINDI: HindiCache = { status: "idle", strings: null, unchanged: [] };

export const INITIAL_UI: UiState = {
  analysisId: null,
  selectedFlagId: null,
  filter: "all",
  sheetOpen: false,
  ticks: [],
  hindi: EMPTY_HINDI,
};

export const INITIAL_RUN: RunSnapshot = { machine: INITIAL_ANALYSIS_STATE, progress: null };

/** One event per row of the SPEC section 9 table. */
export type StateRuleEvent =
  | { type: "LANGUAGE_TOGGLED"; lang: Lang }
  /** A new upload or sample. ticks are the ones stored for that analysis id ([] for a new run). */
  | { type: "NEW_ANALYSIS"; analysisId: string; ticks: string[] }
  | { type: "FILTER_CHANGED"; filter: Filter; firstVisibleFlagId: string | null }
  | { type: "RUN_CANCELLED" }
  | { type: "TO_CHECKLIST" }
  | { type: "RESULTS_REFRESHED" };

/**
 * The reset-and-keep table. Returns the same object for any part it keeps, so
 * callers (and tests) can tell "kept" from "reset" by identity.
 *
 * | Event               | Resets                                           | Keeps                    |
 * | Toggle language     | nothing                                          | everything else          |
 * | New upload / sample | selected flag, filter, ticks, sheet, Hindi cache | language                 |
 * | Change filter       | selected flag (to first visible)                 | ticks, language, the rest|
 * | Cancel a run        | run and progress                                 | language, UI             |
 * | Results → checklist | nothing                                          | everything               |
 * | Refresh on /results | everything                                       | language                 |
 */
export function applyStateRule(snapshot: AppSnapshot, event: StateRuleEvent): AppSnapshot {
  switch (event.type) {
    case "LANGUAGE_TOGGLED":
      return event.lang === snapshot.lang ? snapshot : { ...snapshot, lang: event.lang };
    case "NEW_ANALYSIS":
      return {
        ...snapshot,
        ui: { ...INITIAL_UI, analysisId: event.analysisId, ticks: [...event.ticks] },
      };
    case "FILTER_CHANGED":
      return {
        ...snapshot,
        ui: { ...snapshot.ui, filter: event.filter, selectedFlagId: event.firstVisibleFlagId },
      };
    case "RUN_CANCELLED": {
      const { runId } = snapshot.run.machine;
      if (runId === null) return snapshot;
      const machine = transition(snapshot.run.machine, { type: "CANCEL", runId });
      // Nothing to cancel (idle, done, already failed): the run is left as it is.
      if (machine === snapshot.run.machine) return snapshot;
      return { ...snapshot, run: { machine, progress: null } };
    }
    case "TO_CHECKLIST":
      return snapshot;
    case "RESULTS_REFRESHED":
      return { lang: snapshot.lang, run: INITIAL_RUN, ui: INITIAL_UI };
  }
}

// --- Checklist ticks in sessionStorage, keyed by analysis id (SPEC section 9) ---

export type TickStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readTicks(storage: TickStorage | null, analysisId: string): string[] {
  try {
    const raw = storage?.getItem(TICKS_STORAGE_PREFIX + analysisId) ?? null;
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Blocked storage or a hand-edited value: start with nothing ticked.
    return [];
  }
}

export function writeTicks(storage: TickStorage | null, analysisId: string, ticks: string[]): void {
  try {
    if (ticks.length === 0) storage?.removeItem(TICKS_STORAGE_PREFIX + analysisId);
    else storage?.setItem(TICKS_STORAGE_PREFIX + analysisId, JSON.stringify(ticks));
  } catch {
    // Storage can be blocked; ticks still work for this page view.
  }
}

// --- The store ---

export interface UiStore {
  getState: () => UiState;
  subscribe: (listener: () => void) => () => void;
  /** Used by the rule dispatcher only. */
  replace: (next: UiState) => void;
  selectFlag: (flagId: string | null) => void;
  setSheetOpen: (open: boolean) => void;
  toggleTick: (itemId: string) => void;
  /** Ignored unless analysisId is still the current one (stale translation guard). */
  setHindi: (analysisId: string, hindi: HindiCache) => void;
}

export function createUiStore(storage: TickStorage | null): UiStore {
  let state = INITIAL_UI;
  const listeners = new Set<() => void>();
  const set = (next: UiState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replace: set,
    selectFlag: (flagId) => {
      if (flagId !== state.selectedFlagId) set({ ...state, selectedFlagId: flagId });
    },
    setSheetOpen: (open) => {
      if (open !== state.sheetOpen) set({ ...state, sheetOpen: open });
    },
    toggleTick: (itemId) => {
      if (state.analysisId === null) return;
      const ticks = state.ticks.includes(itemId)
        ? state.ticks.filter((id) => id !== itemId)
        : [...state.ticks, itemId];
      writeTicks(storage, state.analysisId, ticks);
      set({ ...state, ticks });
    },
    setHindi: (analysisId, hindi) => {
      if (analysisId === state.analysisId) set({ ...state, hindi });
    },
  };
}
