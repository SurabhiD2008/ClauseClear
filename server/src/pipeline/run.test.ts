import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analysisResultSchema, computeScore, type Segment } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import type { DraftAnalysis, DraftFlag } from "./merge.js";
import { buildResult, runAnalysis } from "./run.js";
import { recordingRouter } from "./testing/harness.js";
import { verifyDraft } from "./verify.js";

const docs = fileURLToPath(new URL("../../../fixtures/docs/", import.meta.url));
const pdf = async (name: string) => new Uint8Array(await readFile(`${docs}${name}`));

const segments: Segment[] = [
  { id: "s1", page: 1, text: "1. TERM\n\nThe term is eleven months from 1 March 2026." },
  {
    id: "s2",
    page: 1,
    text: "2. DEPOSIT The Licensee shall pay a deposit of Rs. 1,50,000, which the Licensor may keep in full if the Licensee leaves before the lock-in ends.",
  },
  {
    id: "s3",
    page: 2,
    text: "3. FEE The Licensee shall pay “maintenance” of Rs. 2,500 per month.",
  },
];

function flag(
  id: string,
  segmentId: string,
  quote: string,
  extra: Partial<DraftFlag> = {},
): DraftFlag {
  return {
    id,
    kind: "present",
    severity: "high",
    categoryId: "deposit",
    category: "Security deposit",
    title: "Deposit can be kept",
    plain: "The owner may keep the whole deposit.",
    why: "You could lose a large sum.",
    segmentId,
    quote,
    termIds: [],
    ...extra,
  };
}

function draft(flags: DraftFlag[], extra: Partial<DraftAnalysis> = {}): DraftAnalysis {
  return {
    docType: "rental",
    docTypeLabel: "Rental agreement",
    docTypeConfidence: "high",
    title: "Leave and License Agreement",
    summary: "A rental agreement for eleven months. It has a large deposit.",
    flags,
    clauses: [],
    keyFacts: [],
    questions: [],
    checklist: { before: [], after: [] },
    glossary: [],
    coverage: {},
    path: "single",
    calls: 1,
    ...extra,
  };
}

describe("buildResult", () => {
  it("computes the score with the shared function and passes the schema", () => {
    const { draft: verified } = verifyDraft(
      draft([flag("f1", "s1", "The term is eleven months", { severity: "medium" })]),
      segments,
    );
    const result = buildResult(verified, { text: "x".repeat(300), pageCount: 2 }, segments, []);
    expect(result.score).toEqual(computeScore(result.flags));
    expect(result.score.value).toBe(8);
    expect(result.stats).toEqual({ pages: 2, chars: 300, segments: 3 });
    expect(analysisResultSchema.safeParse(result).success).toBe(true);
  });

  it("fails as ANALYSIS_FAILED, naming paths but never values, when the result is invalid", () => {
    const bad = draft([flag("f1", "s1", "The term is eleven months")], { title: "" });
    expect(() => buildResult(bad, { text: "", pageCount: 1 }, segments, [])).toThrow(
      /^ANALYSIS_FAILED: result failed the schema at title$/,
    );
  });
});

describe("runAnalysis: the retry rule", () => {
  it("clean quotes: no retry, no warning, one call", async () => {
    const { router, requests } = recordingRouter();
    const { result, report } = await runAnalysis(
      { kind: "pdf", bytes: await pdf("rental.pdf") },
      { router, maxInputTokens: 24_000 },
    );
    expect(report.retried).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(report.verification.dropped).toBe(0);
  });

  it("more than half wrong (5 of 9): one strict retry, then partial_verification", async () => {
    const { router, requests } = recordingRouter({ scenario: "half_wrong_quotes" });
    const { result, report } = await runAnalysis(
      { kind: "pdf", bytes: await pdf("rental.pdf") },
      { router, maxInputTokens: 24_000 },
    );
    expect(report.verification).toMatchObject({ checked: 9, dropped: 5 });
    expect(report.retried).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.system).toContain("This is a second attempt");
    expect(result.warnings).toEqual(["partial_verification"]);
    expect(result.score).toEqual(computeScore(result.flags));
  });

  it("exactly half wrong (4 of 8) is not more than half: no retry", async () => {
    const { router, requests } = recordingRouter({ scenario: "half_wrong_quotes" });
    const { result, report } = await runAnalysis(
      { kind: "pdf", bytes: await pdf("employment.pdf") },
      { router, maxInputTokens: 24_000 },
    );
    expect(report.verification).toMatchObject({ checked: 8, dropped: 4 });
    expect(report.retried).toBe(false);
    expect(requests).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });
});
