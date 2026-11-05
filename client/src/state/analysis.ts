// The analysis store (SPEC section 9): one run at a time through the shared
// state machine, with a run id per run, an AbortController per request, the
// stale-response guard and double-submit prevention. Samples load through
// /api/samples and never start a run.
import {
  DEVANAGARI_PATTERN,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  PDF_MAGIC,
  errorBody,
  isRunActive,
  transition,
  type AnalysisEvent,
  type AnalysisResult,
  type ErrorBody,
  type TranslationMap,
} from "@clauseclear/shared";
import { ApiError, fromErrorEvent, type AnalyzeInput, type Api } from "../lib/api";
import { INITIAL_RUN, type RunSnapshot } from "./ui";

export type CurrentAnalysis =
  | {
      source: "run";
      analysisId: string;
      result: AnalysisResult;
      /** The uploaded file's name, shown above the result; null for pasted text. */
      fileName: string | null;
      /**
       * What was analysed, kept in memory only so "Not right? Change it" can run it
       * again with another type (SPEC F3). It is never written anywhere.
       */
      input: AnalyzeInput;
    }
  | {
      source: "sample";
      analysisId: string;
      sampleId: string;
      result: AnalysisResult;
      /** The sample's precomputed Hindi; no translation call is made for it. */
      hi: TranslationMap;
    };

export interface AnalysisStoreState {
  run: RunSnapshot;
  /** Why the last run failed (validation, HTTP, or an error event). */
  error: ErrorBody | null;
  /** The result on screen, from a finished run or a sample. */
  current: CurrentAnalysis | null;
  /** Id of the sample being fetched. */
  loadingSample: string | null;
  sampleError: ErrorBody | null;
}

/** Events that belong to the reset-and-keep table; the dispatcher applies them. */
export type AnalysisNotice =
  { type: "NEW_ANALYSIS"; analysisId: string; restoreTicks: boolean } | { type: "RUN_CANCELLED" };

export interface AnalysisDeps {
  api: Pick<Api, "streamAnalysis" | "getSample">;
  emit: (notice: AnalysisNotice) => void;
  newRunAnalysisId?: (runId: number) => string;
}

export interface AnalysisStore {
  getState: () => AnalysisStoreState;
  subscribe: (listener: () => void) => () => void;
  /** Used by the rule dispatcher only. */
  setRun: (run: RunSnapshot) => void;
  /**
   * Starts a run. Returns false, and does nothing, while another run is active:
   * the double-submit guard behind the disabled buttons.
   */
  start: (input: AnalyzeInput) => Promise<boolean>;
  cancel: () => void;
  /**
   * Shows a sample. fresh: a new choice from the page (ticks start empty);
   * otherwise a page load of its URL, which restores ticks from sessionStorage.
   * An active run is aborted, since the sample replaces it.
   */
  openSample: (id: string, options: { fresh: boolean }) => Promise<void>;
}

const INITIAL: AnalysisStoreState = {
  run: INITIAL_RUN,
  error: null,
  current: null,
  loadingSample: null,
  sampleError: null,
};

/** The server's checks, repeated for a quicker answer (the server still enforces them). */
export async function validateInput(input: AnalyzeInput): Promise<ErrorBody | null> {
  if (input.kind === "text") {
    // Raw length: the server measures after normalising, which only shortens the text.
    const length = input.text.trim().length;
    if (length < MIN_TEXT_CHARS) return errorBody("TEXT_TOO_SHORT");
    if (length > MAX_TEXT_CHARS) return errorBody("TEXT_TOO_LONG");
    if (DEVANAGARI_PATTERN.test(input.text)) return errorBody("NOT_ENGLISH");
    return null;
  }
  if (input.file.size === 0) return errorBody("BAD_REQUEST");
  if (input.file.size > MAX_FILE_BYTES) return errorBody("FILE_TOO_LARGE");
  const head = new Uint8Array(await input.file.slice(0, PDF_MAGIC.length).arrayBuffer());
  const magic = String.fromCharCode(...head);
  return magic === PDF_MAGIC ? null : errorBody("NOT_PDF");
}

const toErrorBody = (error: unknown): ErrorBody =>
  error instanceof ApiError ? error.body : errorBody("ANALYSIS_FAILED");

export function createAnalysisStore(deps: AnalysisDeps): AnalysisStore {
  const newRunAnalysisId =
    deps.newRunAnalysisId ?? ((runId: number) => `run:${Date.now().toString(36)}-${String(runId)}`);
  let state = INITIAL;
  const listeners = new Set<() => void>();
  let runCounter = 0;
  let runController: AbortController | null = null;
  let sampleCounter = 0;
  let sampleController: AbortController | null = null;

  const set = (next: AnalysisStoreState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  /** Applies a machine event; false when the machine refused it (stale or out of order). */
  const machine = (
    event: AnalysisEvent,
    patch: Partial<Pick<AnalysisStoreState, "error" | "current">> = {},
  ) => {
    const next = transition(state.run.machine, event);
    if (next === state.run.machine) return false;
    // Progress belongs to an active run only.
    const progress = isRunActive(next.status) ? state.run.progress : null;
    set({ ...state, ...patch, run: { machine: next, progress } });
    return true;
  };

  const abortSample = () => {
    sampleController?.abort();
    sampleController = null;
    sampleCounter += 1;
    if (state.loadingSample !== null) set({ ...state, loadingSample: null });
  };

  const start = async (input: AnalyzeInput): Promise<boolean> => {
    if (isRunActive(state.run.machine.status)) return false;
    abortSample();
    const runId = ++runCounter;
    const controller = new AbortController();
    runController = controller;
    const analysisId = newRunAnalysisId(runId);

    set({
      ...state,
      run: { machine: transition(state.run.machine, { type: "START", runId }), progress: null },
      error: null,
      current: null,
      sampleError: null,
    });
    deps.emit({ type: "NEW_ANALYSIS", analysisId, restoreTicks: false });

    // Any event, response or failure from a run that is no longer current is dropped.
    const stale = () => state.run.machine.runId !== runId || controller.signal.aborted;
    const fail = (body: ErrorBody) => {
      if (!stale()) machine({ type: "FAIL", runId }, { error: body });
    };

    try {
      const invalid = await validateInput(input);
      if (stale()) return true;
      if (invalid !== null) {
        fail(invalid);
        return true;
      }
      machine({ type: "VALIDATED", runId });

      await deps.api.streamAnalysis(input, {
        signal: controller.signal,
        onEvent: (event) => {
          if (stale()) return;
          if (event.type === "status") {
            machine({ type: "STEP", runId, step: event.data.step });
            set({ ...state, run: { ...state.run, progress: event.data } });
          } else if (event.type === "result") {
            machine(
              { type: "RESULT", runId },
              {
                current: {
                  source: "run",
                  analysisId,
                  result: event.data,
                  fileName: input.kind === "file" ? (input.name ?? null) : null,
                  input,
                },
              },
            );
          } else {
            fail(fromErrorEvent(event.data));
          }
        },
      });
      // The stream closed without a result or an error event.
      if (!stale() && isRunActive(state.run.machine.status)) fail(errorBody("ANALYSIS_FAILED"));
    } catch (error) {
      fail(toErrorBody(error));
    } finally {
      if (runController === controller) runController = null;
    }
    return true;
  };

  const cancel = () => {
    if (!isRunActive(state.run.machine.status)) return;
    runController?.abort();
    runController = null;
    deps.emit({ type: "RUN_CANCELLED" });
  };

  const openSample = async (id: string, { fresh }: { fresh: boolean }): Promise<void> => {
    const shown = state.current;
    // A page load of the sample already shown, or already on its way, changes nothing.
    if (!fresh && shown?.source === "sample" && shown.sampleId === id) return;
    if (!fresh && state.loadingSample === id) return;

    if (isRunActive(state.run.machine.status)) {
      runController?.abort();
      runController = null;
      set({ ...state, run: INITIAL_RUN });
    }
    abortSample();
    const request = sampleCounter;
    const controller = new AbortController();
    sampleController = controller;
    set({ ...state, loadingSample: id, sampleError: null });

    try {
      const sample = await deps.api.getSample(id, controller.signal);
      if (request !== sampleCounter) return;
      const analysisId = `sample:${id}`;
      set({
        ...state,
        loadingSample: null,
        error: null,
        current: { source: "sample", analysisId, sampleId: id, result: sample.en, hi: sample.hi },
      });
      deps.emit({ type: "NEW_ANALYSIS", analysisId, restoreTicks: !fresh });
    } catch (error) {
      if (request !== sampleCounter) return;
      set({ ...state, loadingSample: null, sampleError: toErrorBody(error) });
    } finally {
      if (sampleController === controller) sampleController = null;
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRun: (run) => {
      if (run !== state.run) set({ ...state, run });
    },
    start,
    cancel,
    openSample,
  };
}
