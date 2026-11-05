// The analysis flow from SPEC section 9: idle -> validating -> reading -> analyzing
// -> verifying -> done, with error and cancelled reachable from any active step.
// Pure and framework-free so every transition is tested row by row.
import type { PipelineStep } from "./schemas.js";

export type { PipelineStep };

export const ANALYSIS_STATUSES = [
  "idle",
  "validating",
  "reading",
  "analyzing",
  "verifying",
  "done",
  "error",
  "cancelled",
] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export interface AnalysisState {
  status: AnalysisStatus;
  /** Id of the run this state belongs to; events from any other run are stale. */
  runId: number | null;
}

export type AnalysisEvent =
  | { type: "START"; runId: number }
  | { type: "VALIDATED"; runId: number }
  | { type: "STEP"; runId: number; step: PipelineStep }
  | { type: "RESULT"; runId: number }
  | { type: "FAIL"; runId: number }
  | { type: "CANCEL"; runId: number }
  | { type: "RESET" };

export const INITIAL_ANALYSIS_STATE: AnalysisState = { status: "idle", runId: null };

type StreamPhase = "reading" | "analyzing" | "verifying";

/** Server status steps grouped into client phases (ASSUMPTIONS A17). */
const STEP_PHASE: Record<PipelineStep, StreamPhase> = {
  reading: "reading",
  segmenting: "reading",
  detecting: "reading",
  analyzing: "analyzing",
  verifying: "verifying",
  scoring: "verifying",
};

const PHASE_ORDER: Record<StreamPhase, number> = { reading: 0, analyzing: 1, verifying: 2 };

function isStreaming(status: AnalysisStatus): status is StreamPhase {
  return status === "reading" || status === "analyzing" || status === "verifying";
}

/** True while a run is in flight; buttons that start a run are disabled. */
export function isRunActive(status: AnalysisStatus): boolean {
  return status === "validating" || isStreaming(status);
}

/**
 * Returns the next state, or the same state object when the event is refused or stale.
 * START always begins a new run and supersedes an active one: the caller aborts the
 * old request, and the new run id makes any late event from it stale.
 */
export function transition(state: AnalysisState, event: AnalysisEvent): AnalysisState {
  if (event.type === "START") return { status: "validating", runId: event.runId };
  if (event.type === "RESET") return INITIAL_ANALYSIS_STATE;
  if (event.runId !== state.runId) return state;

  switch (event.type) {
    case "VALIDATED":
      return state.status === "validating" ? { ...state, status: "reading" } : state;
    case "STEP": {
      if (!isStreaming(state.status)) return state;
      const phase = STEP_PHASE[event.step];
      // Phases only move forward; a repeated or older step changes nothing.
      return PHASE_ORDER[phase] > PHASE_ORDER[state.status] ? { ...state, status: phase } : state;
    }
    case "RESULT":
      return isStreaming(state.status) ? { ...state, status: "done" } : state;
    case "FAIL":
      return isRunActive(state.status) ? { ...state, status: "error" } : state;
    case "CANCEL":
      return isRunActive(state.status) ? { ...state, status: "cancelled" } : state;
  }
}
