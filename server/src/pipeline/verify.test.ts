import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  QUOTE_FUZZY_MIN_SIMILARITY,
  analysisResultSchema,
  computeScore,
  type Segment,
} from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import type { DraftAnalysis, DraftFlag } from "./merge.js";
import { buildResult, runAnalysis } from "./run.js";
import { recordingRouter } from "./testing/harness.js";
import { fold, matchQuote, numbersIn, tokenSimilarity, verifyDraft } from "./verify.js";

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

describe("quote matching", () => {
  it("folds case, whitespace and curly quotes, and maps back to the original", () => {
    const folded = fold("  A \n“B”  c ");
    expect(folded.text).toBe('a "b" c');
    expect(folded.map).toHaveLength(folded.text.length);
  });

  it("an exact substring passes and keeps the segment's own characters", () => {
    expect(matchQuote("The term is eleven months", segments[0]?.text ?? "")).toEqual({
      kind: "exact",
      quote: "The term is eleven months",
    });
  });

  it("matches across a line break, a case change and straight-for-curly quotes, returning the real slice", () => {
    expect(matchQuote("1. term the TERM is", segments[0]?.text ?? "")).toEqual({
      kind: "exact",
      quote: "1. TERM\n\nThe term is",
    });
    expect(matchQuote('pay "maintenance" of', segments[2]?.text ?? "")).toEqual({
      kind: "exact",
      quote: "pay “maintenance” of",
    });
  });

  it("ignores quote marks around the quote and a trailing ellipsis", () => {
    const m = matchQuote("“The term is eleven months…”", segments[0]?.text ?? "");
    expect(m).toEqual({ kind: "exact", quote: "The term is eleven months" });
  });

  it(`repairs a near miss at similarity >= ${String(QUOTE_FUZZY_MIN_SIMILARITY)} to the segment's real text`, () => {
    // One word of 22 changed ("could" for "may"): Dice 2*21/44 = 0.954.
    const quote =
      "The Licensee shall pay a deposit of Rs. 1,50,000, which the Licensor could keep in full if the Licensee leaves before the lock-in ends";
    const m = matchQuote(quote, segments[1]?.text ?? "");
    expect(m.kind).toBe("repaired");
    if (m.kind !== "repaired") return;
    expect(m.similarity).toBeGreaterThanOrEqual(QUOTE_FUZZY_MIN_SIMILARITY);
    expect(segments[1]?.text).toContain(m.quote);
    expect(m.quote).toMatch(/^The Licensee shall pay.*lock-in ends$/);
  });

  it("drops anything weaker than the threshold", () => {
    const m = matchQuote(
      "The licensee may keep a pet elephant on the premises.",
      segments[1]?.text ?? "",
    );
    expect(m.kind).toBe("missed");
    // Two words changed in a short quote: below 0.9.
    const near = matchQuote("The term is twelve weeks", segments[0]?.text ?? "");
    expect(near.kind).toBe("missed");
    if (near.kind === "missed") expect(near.similarity).toBeLessThan(QUOTE_FUZZY_MIN_SIMILARITY);
  });

  it("token similarity is Dice over word multisets", () => {
    expect(tokenSimilarity(["a", "b"], ["a", "b"])).toBe(1);
    expect(tokenSimilarity(["a", "a"], ["a", "b"])).toBe(0.5);
    expect(tokenSimilarity(["a"], ["b"])).toBe(0);
  });
});

describe("verifyDraft", () => {
  it("keeps verified flags, repairs near misses, drops the rest and counts each", () => {
    const {
      draft: out,
      stats,
      failRatio,
    } = verifyDraft(
      draft([
        flag("f1", "s1", "the term is ELEVEN months"),
        flag("f2", "s9", "The term is eleven months"),
        flag("f3", "s2", "The licensee may keep a pet elephant on the premises."),
        flag("f4", "s3", "The Licensee shall pay maintenance of Rs. 2,500 per month"),
      ]),
      segments,
    );
    expect(stats).toMatchObject({ checked: 4, exact: 1, repaired: 1, dropped: 2 });
    expect(failRatio).toBe(0.5);
    expect(out.flags.map((f) => [f.id, f.segmentId, f.quote])).toEqual([
      ["f1", "s1", "The term is eleven months"],
      ["f2", "s3", "The Licensee shall pay “maintenance” of Rs. 2,500 per month"],
    ]);
  });

  it("passes missing items through and renumbers every reference to surviving flags", () => {
    const missing: DraftFlag = {
      id: "f3",
      kind: "missing",
      severity: "medium",
      categoryId: "stamp-duty",
      category: "Stamp duty and registration",
      title: "No stamp duty clause",
      plain: "It does not say who pays stamp duty.",
      why: "An unregistered agreement may be hard to rely on.",
      termIds: [],
    };
    const { draft: out } = verifyDraft(
      draft(
        [
          flag("f1", "s2", "nothing like this"),
          flag("f2", "s1", "The term is eleven months"),
          missing,
        ],
        {
          clauses: [
            { id: "c1", segmentId: "s1", heading: "Term", plain: "Eleven months.", flagId: "f2" },
            { id: "c2", segmentId: "s2", heading: "Deposit", plain: "A deposit.", flagId: "f1" },
            { id: "c3", segmentId: "s7", heading: "Gone", plain: "No such segment." },
          ],
          questions: [{ id: "q1", text: "Ask about it.", flagIds: ["f1", "f2", "f3"] }],
          checklist: {
            before: [{ id: "b1", text: "Check it.", flagIds: ["f1"] }],
            after: [{ id: "a1", text: "Keep it.", flagIds: ["f3"] }],
          },
        },
      ),
      segments,
    );
    expect(out.flags.map((f) => [f.id, f.kind])).toEqual([
      ["f1", "present"],
      ["f2", "missing"],
    ]);
    expect(out.clauses).toEqual([
      { id: "c1", segmentId: "s1", heading: "Term", plain: "Eleven months.", flagId: "f1" },
      { id: "c2", segmentId: "s2", heading: "Deposit", plain: "A deposit." },
    ]);
    expect(out.questions[0]?.flagIds).toEqual(["f1", "f2"]);
    expect(out.checklist.before[0]?.flagIds).toEqual([]);
    expect(out.checklist.after[0]?.flagIds).toEqual(["f2"]);
  });

  it("drops a key fact with any number not in the document, and an unknown segmentId", () => {
    expect(numbersIn("Rs. 1,50,000 or 1.5% by 2026")).toEqual(["150000", "1.5", "2026"]);
    const { draft: out, stats } = verifyDraft(
      draft([], {
        keyFacts: [
          { id: "k1", label: "Deposit", value: "Rs. 1,50,000", segmentId: "s2" },
          { id: "k2", label: "Rent", value: "Rs. 28,000 per month" },
          { id: "k3", label: "Term", value: "Eleven months", segmentId: "s8" },
          { id: "k4", label: "Maintenance", value: "Rs. 2,500 and Rs. 1,50,000" },
        ],
      }),
      segments,
    );
    expect(out.keyFacts).toEqual([
      { id: "k1", label: "Deposit", value: "Rs. 1,50,000", segmentId: "s2" },
      { id: "k3", label: "Term", value: "Eleven months" },
      { id: "k4", label: "Maintenance", value: "Rs. 2,500 and Rs. 1,50,000" },
    ]);
    expect(stats.keyFactsDropped).toBe(1);
  });

  it("drops glossary terms not in the document, and their termIds", () => {
    const { draft: out, stats } = verifyDraft(
      draft([flag("f1", "s2", "which the Licensor may keep in full", { termIds: ["g1", "g2"] })], {
        glossary: [
          { id: "g1", term: "Lock-in", definition: "A period you cannot leave in." },
          { id: "g2", term: "Escalation", definition: "A yearly rise." },
        ],
      }),
      segments,
    );
    expect(out.glossary.map((g) => g.term)).toEqual(["Lock-in"]);
    expect(out.flags[0]?.termIds).toEqual(["g1"]);
    expect(stats.termsDropped).toBe(1);
  });
});

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
