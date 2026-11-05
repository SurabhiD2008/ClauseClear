import { TRANSLATE_BATCH_TOKENS, type TranslationMap } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import type { GenerateJsonRequest } from "../llm/provider.js";
import { MOCK_HINDI_PREFIX } from "../llm/mockModel.js";
import { recordingRouter } from "../pipeline/testing/harness.js";
import { keepsNumbers, protectedTokens } from "./check.js";
import { batchStrings, entryTokens, translateStrings } from "./translate.js";

const strings: TranslationMap = {
  summary: "You pay a deposit of ₹1,10,000 and rent of ₹25,000 a month.",
  "flags.f1.plain": "Late rent costs 2% a day from 5 October 2026.",
  "flags.f1.why": "This may be risky because the fee has no cap.",
  "keyFacts.k1.value": "₹25,000",
};

/** The strings a translation request carried, read back from its data block. */
function sentStrings(request: GenerateJsonRequest | undefined): TranslationMap {
  const match = /=====BEGIN STRINGS [0-9a-f]{8}=====\n([\s\S]*?)\n=====END STRINGS/.exec(
    request?.user ?? "",
  );
  return JSON.parse(match?.[1] ?? "{}") as TranslationMap;
}

/** A model that translates like the mock, then lets the test change the answer per call. */
function scripted(edit: (call: number, answer: TranslationMap) => TranslationMap) {
  let call = 0;
  return recordingRouter({
    override: (request) => {
      if (request.schemaName !== "translation") return undefined;
      const answer = Object.fromEntries(
        Object.entries(sentStrings(request)).map(([k, v]) => [k, `${MOCK_HINDI_PREFIX}${v}`]),
      );
      call += 1;
      return JSON.stringify(edit(call, answer));
    },
  });
}

describe("the number check", () => {
  it("compares digit runs, currency symbols and percent signs in any order", () => {
    expect(protectedTokens("₹1,10,000 at 2% from 5 Oct")).toEqual(
      ["%", "000", "1", "10", "2", "5", "₹"].sort(),
    );
    expect(keepsNumbers("Pay ₹500 by day 5", "दिन 5 तक ₹500 दें")).toBe(true);
    expect(keepsNumbers("Pay ₹500", "₹50 दें")).toBe(false);
    expect(keepsNumbers("2% a day", "रोज़ 2 प्रतिशत")).toBe(false);
    expect(keepsNumbers("Pay ₹500", "500 रुपये दें")).toBe(false);
    // Devanagari digits are not the same digits.
    expect(keepsNumbers("11 months", "११ महीने")).toBe(false);
    expect(keepsNumbers("eleven months", "ग्यारह महीने")).toBe(true);
  });
});

describe("batching", () => {
  it("packs strings in order into batches of at most the batch size", () => {
    const many: TranslationMap = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [`clauses.c${String(i)}.plain`, "word ".repeat(80)]),
    );
    const batches = batchStrings(many);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((b) => Object.keys(b))).toEqual(Object.keys(many));
    for (const batch of batches) {
      const tokens = Object.entries(batch).reduce((sum, [k, v]) => sum + entryTokens(k, v), 0);
      expect(tokens).toBeLessThanOrEqual(TRANSLATE_BATCH_TOKENS);
    }
  });

  it("sends a string bigger than the batch on its own", () => {
    const big = "x ".repeat(TRANSLATE_BATCH_TOKENS * 3);
    expect(batchStrings({ a: "small", b: big, c: "small" }).map((b) => Object.keys(b))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });
});

describe("translateStrings with the mock provider", () => {
  it("matches: every key comes back in Hindi in one call, in input order", async () => {
    const { router, requests } = recordingRouter();
    const out = await translateStrings(strings, { router });
    expect(out.unchanged).toEqual([]);
    expect(out.calls).toBe(1);
    expect(Object.keys(out.strings)).toEqual(Object.keys(strings));
    expect(out.strings.summary).toBe(`${MOCK_HINDI_PREFIX}${strings.summary ?? ""}`);
    // An amount with no letters is not sent at all.
    expect(out.strings["keyFacts.k1.value"]).toBe("₹25,000");
    expect(Object.keys(sentStrings(requests[0]))).not.toContain("keyFacts.k1.value");
    expect(requests.map((r) => r.schemaName)).toEqual(["translation"]);
  });

  it("the prompt carries the SPEC term list and the number rule", async () => {
    const { router, requests } = recordingRouter();
    await translateStrings(strings, { router });
    const system = requests[0]?.system ?? "";
    expect(system).toContain("security deposit = सिक्योरिटी डिपॉजिट");
    expect(system).toContain("agreement = समझौता");
    expect(system).toContain("never spell a number as words");
    expect(system).toContain("exactly the same keys");
  });

  it("splits a large request into batches, one call each", async () => {
    const { router, requests } = recordingRouter();
    const many: TranslationMap = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`clauses.c${String(i)}.plain`, "word ".repeat(150)]),
    );
    const out = await translateStrings(many, { router });
    expect(out.calls).toBe(requests.length);
    expect(requests.length).toBeGreaterThan(1);
    expect(out.unchanged).toEqual([]);
  });

  it("a mismatch is retried once with only that key, and the fix is kept", async () => {
    const { router, requests } = scripted((call, answer) =>
      call === 1 ? { ...answer, "flags.f1.plain": "रोज़ 3% देर से किराया" } : answer,
    );
    const out = await translateStrings(strings, { router });
    expect(out.unchanged).toEqual([]);
    expect(out.calls).toBe(2);
    expect(out.retried).toBe(1);
    expect(Object.keys(sentStrings(requests[1]))).toEqual(["flags.f1.plain"]);
    expect(requests[1]?.system).toContain("Last time");
    expect(out.strings["flags.f1.plain"]).toContain(MOCK_HINDI_PREFIX);
  });

  it("a mismatch that survives the retry stays English and is listed as unchanged", async () => {
    const { router, requests } = scripted((_call, answer) => ({
      ...answer,
      summary: "आप ₹1,10,000 डिपॉजिट देते हैं", // drops the rent amount
    }));
    const out = await translateStrings(strings, { router });
    expect(requests).toHaveLength(2);
    expect(out.unchanged).toEqual(["summary"]);
    expect(out.strings.summary).toBe(strings.summary);
    expect(out.strings["flags.f1.why"]).toContain(MOCK_HINDI_PREFIX);
  });

  it("a missing key is asked for again, then stays English", async () => {
    const { router } = scripted((_call, answer) => {
      const rest = { ...answer };
      delete rest["flags.f1.why"];
      return rest;
    });
    const out = await translateStrings(strings, { router });
    expect(out.unchanged).toEqual(["flags.f1.why"]);
    expect(out.strings["flags.f1.why"]).toBe(strings["flags.f1.why"]);
    expect(Object.keys(out.strings)).toEqual(Object.keys(strings));
  });

  it("extra keys in the answer are ignored", async () => {
    const { router } = scripted((_call, answer) => ({
      ...answer,
      "flags.f9.plain": "नया",
      quote: "something else",
    }));
    const out = await translateStrings(strings, { router });
    expect(Object.keys(out.strings)).toEqual(Object.keys(strings));
    expect(out.unchanged).toEqual([]);
  });

  it("an empty answer for a key counts as missing", async () => {
    const { router } = scripted((_call, answer) => ({ ...answer, summary: "  " }));
    const out = await translateStrings(strings, { router });
    expect(out.unchanged).toEqual(["summary"]);
  });
});
