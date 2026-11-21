import { describe, expect, it } from "vitest";
import { recordingRouter } from "../pipeline/testing/harness.js";
import { loadCases, runCase, summarise } from "./evalSet.js";

const cases = loadCases();

describe("the evaluation set", () => {
  it("has at least 30 cases: 20 typical, 5 edge and 5 adversarial", () => {
    const count = (kind: string) => cases.filter((c) => c.kind === kind).length;
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(count("typical")).toBeGreaterThanOrEqual(20);
    expect(count("edge")).toBeGreaterThanOrEqual(5);
    expect(count("adversarial")).toBeGreaterThanOrEqual(5);
  });

  it("holds out at least 30% of the cases from tuning", () => {
    const holdout = cases.filter((c) => c.split === "holdout").length;
    expect(holdout / cases.length).toBeGreaterThanOrEqual(0.3);
  });

  it("every case states an expected outcome", () => {
    for (const c of cases) expect(Object.keys(c.expect).length).toBeGreaterThan(0);
  });
});

// On the mock provider only the outcomes decided in code are required: refusal
// codes, the keyword-detected type and quotes that are really in their clause.
describe("the evaluation set on the mock provider", () => {
  for (const c of cases) {
    it(`${c.id}: outcomes decided in code hold`, async () => {
      const outcome = await runCase(c, recordingRouter().router, 24_000);
      expect(outcome.codeFailures).toEqual([]);
    }, 30_000);
  }

  it("the summary counts tuned and held-out cases apart", async () => {
    const outcomes = await Promise.all(
      cases.slice(0, 4).map((c) => runCase(c, recordingRouter().router, 24_000)),
    );
    const summary = summarise(outcomes);
    expect(summary.map((s) => s.split)).toEqual(["tune", "holdout"]);
    expect(summary.reduce((sum, s) => sum + s.cases, 0)).toBe(4);
  });
});

describe("an evaluation case when the providers fail", () => {
  it("is recorded as a model-side failure instead of stopping the run", async () => {
    const c = cases.find((x) => x.id === "rental-entry-no-notice");
    if (c === undefined) throw new Error("case missing");
    const outcome = await runCase(c, recordingRouter({ scenario: "server_error" }).router, 24_000);
    expect(outcome.codeFailures).toEqual([]);
    expect(outcome.modelFailures).toEqual(["providers failed: PROVIDER_UNAVAILABLE"]);
  }, 60_000);
});
