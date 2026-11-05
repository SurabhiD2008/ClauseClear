import type { Segment } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { AuthError } from "../llm/provider.js";
import { confidentType, detectType, detectionSample, keywordScores } from "./detectType.js";
import { fixtureSegments, recordingRouter } from "./testing/harness.js";

const asSegments = (...texts: string[]): Segment[] =>
  texts.map((text, i) => ({ id: `s${String(i + 1)}`, page: 1, text }));

describe("the confidence rule", () => {
  it("is confident at a top score of at least 6 and at least twice the runner-up", () => {
    expect(confidentType({ rental: 6, employment: 3, loan: 0, terms: 0 })).toBe("rental");
    expect(confidentType({ rental: 6, employment: 4, loan: 0, terms: 0 })).toBeUndefined();
    expect(confidentType({ rental: 5, employment: 0, loan: 0, terms: 0 })).toBeUndefined();
    expect(confidentType({ rental: 0, employment: 0, loan: 20, terms: 10 })).toBe("loan");
    expect(confidentType({ rental: 0, employment: 0, loan: 0, terms: 0 })).toBeUndefined();
  });

  it("caps each keyword at three occurrences", () => {
    const text = "tenant ".repeat(50);
    expect(keywordScores(text).rental).toBe(3 * 2);
  });

  it("matches whole words and phrases across line breaks", () => {
    expect(keywordScores("rental agreement").rental).toBe(3);
    expect(keywordScores("rent\nagreement").rental).toBeGreaterThanOrEqual(3);
    expect(keywordScores("parent appointments").rental).toBe(0);
  });
});

describe("detectType on the fixtures", () => {
  it.each([
    ["rental.pdf", "rental", "Rental agreement"],
    ["employment.pdf", "employment", "Employment offer or contract"],
    ["loan.pdf", "loan", "Loan or credit agreement"],
    ["terms.pdf", "terms", "Terms of service"],
  ] as const)(
    "%s is detected as %s by keywords alone, with no model call",
    async (name, type, label) => {
      const { segments } = await fixtureSegments(name);
      const { router, requests } = recordingRouter();
      const result = await detectType(segments, { router });
      expect(result).toMatchObject({
        docType: type,
        docTypeLabel: label,
        confidence: "high",
        method: "keywords",
      });
      expect(requests).toHaveLength(0);
    },
  );

  it.each(["general-contract.pdf", "injection.pdf", "long-paragraph.pdf", "two-column.pdf"])(
    "%s is not confident, so one small model call decides",
    async (name) => {
      const { segments } = await fixtureSegments(name);
      expect(confidentType(keywordScores(segments.map((s) => s.text).join("\n")))).toBeUndefined();
      const { router, requests } = recordingRouter({
        override: () =>
          JSON.stringify({ docType: "other", confidence: "medium", label: "Service agreement" }),
      });
      const result = await detectType(segments, { router });
      expect(result).toMatchObject({
        docType: "other",
        docTypeLabel: "Service agreement",
        confidence: "medium",
        method: "model",
      });
      expect(requests.map((r) => r.schemaName)).toEqual(["docType"]);
    },
  );
});

describe("detectType on ambiguous and non-legal text", () => {
  const ambiguous = asSegments(
    "The tenant shall pay rent for the premises. The borrower shall repay the loan in instalments to the lender.",
    "The landlord holds a security deposit. The guarantor promises to pay if the borrower defaults.",
  );
  const recipe = asSegments(
    "Heat two spoons of oil in a pan. Add mustard seeds and curry leaves and wait until they crackle.",
    "Stir in the cooked rice, salt and lemon juice. Serve hot with coconut chutney.",
  );

  it("sends ambiguous text (rental and loan words in equal measure) to the model", async () => {
    const scores = keywordScores(ambiguous.map((s) => s.text).join("\n"));
    expect(scores.rental).toBeGreaterThan(0);
    expect(scores.loan).toBeGreaterThan(0);
    const { router, requests } = recordingRouter({
      override: () => JSON.stringify({ docType: "loan", confidence: "low" }),
    });
    const result = await detectType(ambiguous, { router });
    expect(result).toMatchObject({
      docType: "loan",
      confidence: "low",
      method: "model",
      docTypeLabel: "Loan or credit agreement",
    });
    expect(requests).toHaveLength(1);
  });

  it("sends non-legal text to the model; the model decides it is other", async () => {
    expect(
      Object.values(keywordScores(recipe.map((s) => s.text).join("\n"))).every((n) => n === 0),
    ).toBe(true);
    const { router, requests } = recordingRouter({
      override: () => JSON.stringify({ docType: "other", confidence: "high", label: "Recipe" }),
    });
    const result = await detectType(recipe, { router });
    expect(result).toMatchObject({ docType: "other", docTypeLabel: "Recipe", method: "model" });
    // The detection prompt carries the text inside the document markers.
    expect(requests[0]?.user).toContain("[s1] Heat two spoons of oil");
  });

  it("keeps the keyword leader at low confidence when no provider can answer", async () => {
    const { router } = recordingRouter({
      override: () => {
        throw new AuthError("mock", 401);
      },
    });
    expect(await detectType(ambiguous, { router })).toMatchObject({
      confidence: "low",
      method: "fallback",
    });
    expect(await detectType(recipe, { router })).toMatchObject({
      docType: "other",
      confidence: "low",
      method: "fallback",
    });
  });

  it("a user override skips both keywords and the model", async () => {
    const { router, requests } = recordingRouter();
    const result = await detectType(recipe, { router, override: "employment" });
    expect(result).toMatchObject({ docType: "employment", confidence: "high", method: "override" });
    expect(requests).toHaveLength(0);
  });

  it("an abort during the model call is not swallowed by the fallback", async () => {
    const controller = new AbortController();
    const { router } = recordingRouter({ delayMs: 1_000 });
    const pending = detectType(recipe, { router, signal: controller.signal });
    controller.abort(new Error("client went away"));
    await expect(pending).rejects.toThrow("client went away");
  });

  it("samples at most the first 3,000 tokens for the model call", () => {
    const long = asSegments(...Array.from({ length: 40 }, () => "x".repeat(800)));
    const sample = detectionSample(long);
    expect(sample.map((s) => s.text.length).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12_000);
    expect(sample.length).toBe(15);
  });
});
