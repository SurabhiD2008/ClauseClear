// The analysis store: one run at a time through the shared
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
       * again with another type. It is never written anywhere.
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

/** The store's state and its one run and one sample request in flight. */
class Store {
  state = INITIAL;
  readonly listeners = new Set<() => void>();
  private runCounter = 0;
  private runController: AbortController | null = null;
  private sampleCounter = 0;
  private sampleController: AbortController | null = null;
  private readonly newRunAnalysisId: (runId: number) => string;

  constructor(private readonly deps: AnalysisDeps) {
    this.newRunAnalysisId =
      deps.newRunAnalysisId ??
      ((runId: number) => `run:${Date.now().toString(36)}-${String(runId)}`);
  }

  set(next: AnalysisStoreState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** Applies a machine event; false when the machine refused it (stale or out of order). */
  private machine(
    event: AnalysisEvent,
    patch: Partial<Pick<AnalysisStoreState, "error" | "current">> = {},
  ) {
    const next = transition(this.state.run.machine, event);
    if (next === this.state.run.machine) return false;
    // Progress belongs to an active run only.
    const progress = isRunActive(next.status) ? this.state.run.progress : null;
    this.set({ ...this.state, ...patch, run: { machine: next, progress } });
    return true;
  }

  private abortSample(): void {
    this.sampleController?.abort();
    this.sampleController = null;
    this.sampleCounter += 1;
    if (this.state.loadingSample !== null) this.set({ ...this.state, loadingSample: null });
  }

  async start(input: AnalyzeInput): Promise<boolean> {
    if (isRunActive(this.state.run.machine.status)) return false;
    this.abortSample();
    const runId = ++this.runCounter;
    const controller = new AbortController();
    this.runController = controller;
    const analysisId = this.newRunAnalysisId(runId);
    this.set({
      ...this.state,
      run: {
        machine: transition(this.state.run.machine, { type: "START", runId }),
        progress: null,
      },
      error: null,
      current: null,
      sampleError: null,
    });
    this.deps.emit({ type: "NEW_ANALYSIS", analysisId, restoreTicks: false });
    // Any event, response or failure from a run that is no longer current is dropped.
    const stale = () => this.state.run.machine.runId !== runId || controller.signal.aborted;
    const fail = (body: ErrorBody) => {
      if (!stale()) this.machine({ type: "FAIL", runId }, { error: body });
    };
    try {
      const invalid = await validateInput(input);
      if (stale()) return true;
      if (invalid !== null) {
        fail(invalid);
        return true;
      }
      this.machine({ type: "VALIDATED", runId });
      await this.stream(input, { runId, analysisId, controller, stale, fail });
      // The stream closed without a result or an error event.
      if (!stale() && isRunActive(this.state.run.machine.status))
        fail(errorBody("ANALYSIS_FAILED"));
    } catch (error) {
      fail(toErrorBody(error));
    } finally {
      if (this.runController === controller) this.runController = null;
    }
    return true;
  }

  /** Streams one run's events into the machine, ignoring any that arrive once it is stale. */
  private async stream(input: AnalyzeInput, run: RunHandles): Promise<void> {
    const { runId, analysisId, stale, fail } = run;
    await this.deps.api.streamAnalysis(input, {
      signal: run.controller.signal,
      onEvent: (event) => {
        if (stale()) return;
        if (event.type === "status") {
          this.machine({ type: "STEP", runId, step: event.data.step });
          this.set({ ...this.state, run: { ...this.state.run, progress: event.data } });
        } else if (event.type === "result") {
          const fileName = input.kind === "file" ? (input.name ?? null) : null;
          this.machine(
            { type: "RESULT", runId },
            { current: { source: "run", analysisId, result: event.data, fileName, input } },
          );
        } else {
          fail(fromErrorEvent(event.data));
        }
      },
    });
  }

  cancel(): void {
    if (!isRunActive(this.state.run.machine.status)) return;
    this.runController?.abort();
    this.runController = null;
    this.deps.emit({ type: "RUN_CANCELLED" });
  }

  async openSample(id: string, { fresh }: { fresh: boolean }): Promise<void> {
    const shown = this.state.current;
    // A page load of the sample already shown, or already on its way, changes nothing.
    if (!fresh && shown?.source === "sample" && shown.sampleId === id) return;
    if (!fresh && this.state.loadingSample === id) return;
    if (isRunActive(this.state.run.machine.status)) {
      this.runController?.abort();
      this.runController = null;
      this.set({ ...this.state, run: INITIAL_RUN });
    }
    this.abortSample();
    const request = this.sampleCounter;
    const controller = new AbortController();
    this.sampleController = controller;
    this.set({ ...this.state, loadingSample: id, sampleError: null });
    try {
      const sample = await this.deps.api.getSample(id, controller.signal);
      if (request !== this.sampleCounter) return;
      const analysisId = `sample:${id}`;
      this.set({
        ...this.state,
        loadingSample: null,
        error: null,
        current: { source: "sample", analysisId, sampleId: id, result: sample.en, hi: sample.hi },
      });
      this.deps.emit({ type: "NEW_ANALYSIS", analysisId, restoreTicks: !fresh });
    } catch (error) {
      if (request !== this.sampleCounter) return;
      this.set({ ...this.state, loadingSample: null, sampleError: toErrorBody(error) });
    } finally {
      if (this.sampleController === controller) this.sampleController = null;
    }
  }
}

interface RunHandles {
  runId: number;
  analysisId: string;
  controller: AbortController;
  stale: () => boolean;
  fail: (body: ErrorBody) => void;
}

export function createAnalysisStore(deps: AnalysisDeps): AnalysisStore {
  const store = new Store(deps);
  return {
    getState: () => store.state,
    subscribe: (listener) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    setRun: (run) => {
      if (run !== store.state.run) store.set({ ...store.state, run });
    },
    start: (input) => store.start(input),
    cancel: () => {
      store.cancel();
    },
    openSample: (id, options) => store.openSample(id, options),
  };
}
