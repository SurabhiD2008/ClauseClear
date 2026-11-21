import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_STATUSES,
  INITIAL_ANALYSIS_STATE,
  transition,
  type AnalysisEvent,
  type AnalysisState,
} from "./analysisMachine.js";
import { SCORE_MAX } from "./constants.js";
import { bandForScore, computeScore, type ScoredFlag } from "./scoring.js";

const flagArb: fc.Arbitrary<ScoredFlag> = fc.record({
  kind: fc.constantFrom("present" as const, "missing" as const),
  severity: fc.constantFrom("high" as const, "medium" as const),
});

describe("computeScore properties", () => {
  it("the value stays between 0 and the maximum, and its band matches it", () => {
    fc.assert(
      fc.property(fc.array(flagArb, { maxLength: 40 }), (flags) => {
        const score = computeScore(flags);
        expect(score.value).toBeGreaterThanOrEqual(0);
        expect(score.value).toBeLessThanOrEqual(SCORE_MAX);
        expect(score.band).toBe(bandForScore(score.value));
      }),
    );
  });

  it("does not depend on the order of the flags", () => {
    fc.assert(
      fc.property(
        fc
          .array(flagArb, { maxLength: 20 })
          .chain((flags) =>
            fc.tuple(
              fc.constant(flags),
              fc.shuffledSubarray(flags, { minLength: flags.length, maxLength: flags.length }),
            ),
          ),
        ([flags, shuffled]) => {
          expect(computeScore(shuffled)).toEqual(computeScore(flags));
        },
      ),
    );
  });

  it("counts add up to the flags given", () => {
    fc.assert(
      fc.property(fc.array(flagArb, { maxLength: 40 }), (flags) => {
        const { counts } = computeScore(flags);
        expect(counts.high + counts.medium + counts.missing).toBe(flags.length);
      }),
    );
  });

  it("adding a flag never lowers the score", () => {
    fc.assert(
      fc.property(fc.array(flagArb, { maxLength: 30 }), flagArb, (flags, extra) => {
        expect(computeScore([...flags, extra]).value).toBeGreaterThanOrEqual(
          computeScore(flags).value,
        );
      }),
    );
  });
});

const runId = fc.integer({ min: 1, max: 4 });
const eventArb: fc.Arbitrary<AnalysisEvent> = fc.oneof(
  runId.map((id) => ({ type: "START" as const, runId: id })),
  runId.map((id) => ({ type: "VALIDATED" as const, runId: id })),
  fc.record({
    type: fc.constant("STEP" as const),
    runId,
    step: fc.constantFrom(
      "reading" as const,
      "segmenting" as const,
      "detecting" as const,
      "analyzing" as const,
      "verifying" as const,
      "scoring" as const,
    ),
  }),
  runId.map((id) => ({ type: "RESULT" as const, runId: id })),
  runId.map((id) => ({ type: "FAIL" as const, runId: id })),
  runId.map((id) => ({ type: "CANCEL" as const, runId: id })),
  fc.constant({ type: "RESET" as const }),
);

describe("analysis state machine properties", () => {
  it("any sequence of events leaves a known status", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 30 }), (events) => {
        const end = events.reduce<AnalysisState>(transition, INITIAL_ANALYSIS_STATE);
        expect(ANALYSIS_STATUSES).toContain(end.status);
      }),
    );
  });

  it("an event for another run never changes the state", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 20 }), eventArb, (events, event) => {
        const state = events.reduce<AnalysisState>(transition, INITIAL_ANALYSIS_STATE);
        const foreign =
          event.type !== "START" && event.type !== "RESET" && event.runId !== state.runId;
        // Only events for another run are checked; every other case holds trivially.
        expect(!foreign || transition(state, event) === state).toBe(true);
      }),
    );
  });

  it("repeating a non-START event changes nothing the second time", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 20 }), eventArb, (events, event) => {
        const state = events.reduce<AnalysisState>(transition, INITIAL_ANALYSIS_STATE);
        const once = transition(state, event);
        // START always begins a new run, so only the other events must be idempotent.
        expect(event.type === "START" ? once : transition(once, event)).toEqual(once);
      }),
    );
  });

  it("done, error and cancelled are left only by START or RESET", () => {
    fc.assert(
      fc.property(
        runId,
        fc.constantFrom("RESULT" as const, "FAIL" as const, "CANCEL" as const),
        eventArb.filter((e) => e.type !== "START" && e.type !== "RESET"),
        (id, ending, event) => {
          // A run taken to its end, so every case checks a terminal state.
          const steps: AnalysisEvent[] = [
            { type: "START", runId: id },
            { type: "VALIDATED", runId: id },
            { type: ending, runId: id },
          ];
          const state = steps.reduce<AnalysisState>(transition, INITIAL_ANALYSIS_STATE);
          expect(["done", "error", "cancelled"]).toContain(state.status);
          expect(transition(state, event)).toBe(state);
        },
      ),
    );
  });
});
