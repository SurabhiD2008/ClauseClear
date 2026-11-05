import { describe, expect, it } from "vitest";
import {
  ANALYSIS_STATUSES,
  INITIAL_ANALYSIS_STATE,
  transition,
  type AnalysisEvent,
  type AnalysisStatus,
  type PipelineStep,
} from "./analysisMachine.js";

const RUN = 7;

function stateIn(status: AnalysisStatus) {
  return { status, runId: status === "idle" ? null : RUN };
}

/** One event of each kind, all for the current run (except START, which begins run 8). */
const EVENTS: Record<string, AnalysisEvent> = {
  START: { type: "START", runId: RUN + 1 },
  VALIDATED: { type: "VALIDATED", runId: RUN },
  "STEP reading": { type: "STEP", runId: RUN, step: "reading" },
  "STEP analyzing": { type: "STEP", runId: RUN, step: "analyzing" },
  "STEP verifying": { type: "STEP", runId: RUN, step: "verifying" },
  RESULT: { type: "RESULT", runId: RUN },
  FAIL: { type: "FAIL", runId: RUN },
  CANCEL: { type: "CANCEL", runId: RUN },
  RESET: { type: "RESET" },
};

// Expected next status for every state x event. "-" means refused (state unchanged).
// Columns follow the order of EVENTS above.
const MATRIX: Record<AnalysisStatus, string[]> = {
  //          START        VALIDATED  STEP read  STEP anlz    STEP verf    RESULT  FAIL     CANCEL       RESET
  idle: ["validating", "-", "-", "-", "-", "-", "-", "-", "idle"],
  validating: ["validating", "reading", "-", "-", "-", "-", "error", "cancelled", "idle"],
  reading: [
    "validating",
    "-",
    "reading",
    "analyzing",
    "verifying",
    "done",
    "error",
    "cancelled",
    "idle",
  ],
  analyzing: [
    "validating",
    "-",
    "-",
    "analyzing",
    "verifying",
    "done",
    "error",
    "cancelled",
    "idle",
  ],
  verifying: ["validating", "-", "-", "-", "verifying", "done", "error", "cancelled", "idle"],
  done: ["validating", "-", "-", "-", "-", "-", "-", "-", "idle"],
  error: ["validating", "-", "-", "-", "-", "-", "-", "-", "idle"],
  cancelled: ["validating", "-", "-", "-", "-", "-", "-", "-", "idle"],
};

describe("analysis state machine (SPEC section 9)", () => {
  it("covers every status in the matrix", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...ANALYSIS_STATUSES].sort());
  });

  it("starts idle with no run", () => {
    expect(INITIAL_ANALYSIS_STATE).toEqual({ status: "idle", runId: null });
  });

  const eventNames = Object.keys(EVENTS);
  for (const status of ANALYSIS_STATUSES) {
    describe(`from ${status}`, () => {
      eventNames.forEach((name, column) => {
        const expected = MATRIX[status][column];
        it(`${name} -> ${expected === "-" ? "refused" : String(expected)}`, () => {
          const before = stateIn(status);
          const event = EVENTS[name];
          if (event === undefined) throw new Error(name);
          const after = transition(before, event);
          if (expected === "-") {
            expect(after).toBe(before);
          } else {
            expect(after.status).toBe(expected);
          }
        });
      });
    });
  }

  it("START records the new run id; RESET clears it", () => {
    const started = transition(stateIn("done"), { type: "START", runId: 9 });
    expect(started).toEqual({ status: "validating", runId: 9 });
    expect(transition(started, { type: "RESET" })).toEqual(INITIAL_ANALYSIS_STATE);
  });

  it.each(["reading", "segmenting", "detecting"] as PipelineStep[])(
    "server step %s maps to reading",
    (step) => {
      expect(transition(stateIn("reading"), { type: "STEP", runId: RUN, step }).status).toBe(
        "reading",
      );
    },
  );

  it("server step scoring maps to verifying", () => {
    expect(
      transition(stateIn("analyzing"), { type: "STEP", runId: RUN, step: "scoring" }).status,
    ).toBe("verifying");
  });

  describe("stale-run guard", () => {
    const stale = RUN - 1;
    it.each([
      { type: "VALIDATED", runId: stale },
      { type: "STEP", runId: stale, step: "verifying" },
      { type: "RESULT", runId: stale },
      { type: "FAIL", runId: stale },
      { type: "CANCEL", runId: stale },
    ] as AnalysisEvent[])("ignores $type from an older run", (event) => {
      for (const status of ANALYSIS_STATUSES) {
        const before = stateIn(status);
        expect(transition(before, event)).toBe(before);
      }
    });

    it("a superseded run cannot finish the new one", () => {
      let state = transition(stateIn("analyzing"), { type: "START", runId: RUN + 1 });
      state = transition(state, { type: "RESULT", runId: RUN });
      expect(state).toEqual({ status: "validating", runId: RUN + 1 });
    });
  });
});
