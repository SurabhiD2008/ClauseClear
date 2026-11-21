import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { keepsNumbers } from "../translate/check.js";
import { normalizeText } from "./normalize.js";
import { segmentDocument, splitLong } from "./segment.js";
import { matchQuote } from "./verify.js";

const word = fc.stringMatching(/^[A-Za-z]{1,10}$/);
const sentence = fc.array(word, { minLength: 3, maxLength: 14 }).map((w) => `${w.join(" ")}.`);
const paragraph = fc.array(sentence, { minLength: 1, maxLength: 6 }).map((s) => s.join(" "));
const anyText = fc.string({ maxLength: 400, unit: "binary" });

describe("normalizeText properties", () => {
  it("is idempotent: normalising twice equals normalising once", () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const once = normalizeText(text);
        expect(normalizeText(once)).toBe(once);
      }),
    );
  });

  it("never leaves control characters other than line breaks", () => {
    fc.assert(
      fc.property(anyText, (text) => {
        expect(/[\u0000-\u0009\u000b-\u001f\u007f]/.test(normalizeText(text))).toBe(false);
      }),
    );
  });
});

describe("segmenting properties", () => {
  it("splitLong keeps every piece within the limit and loses no words", () => {
    fc.assert(
      fc.property(
        fc.array(paragraph, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 80, max: 400 }),
        (paras, max) => {
          const text = paras.join(" ");
          const pieces = splitLong(text, max);
          for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(max);
          expect(pieces.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
        },
      ),
    );
  });

  it("segment ids are s1, s2, ... in order and every segment has text", () => {
    fc.assert(
      fc.property(fc.array(paragraph, { minLength: 1, maxLength: 10 }), (paras) => {
        const segments = segmentDocument([{ page: 1, text: paras.join("\n\n") }]);
        segments.forEach((s, i) => {
          expect(s.id).toBe(`s${String(i + 1)}`);
          expect(s.text.trim().length).toBeGreaterThan(0);
        });
      }),
    );
  });
});

describe("quote verification properties", () => {
  it("any exact slice of words from a segment is found exactly, and the returned quote is in the segment", () => {
    fc.assert(
      fc.property(paragraph, fc.nat(), fc.nat(), (text, a, b) => {
        const words = text.split(" ");
        const from = a % words.length;
        const to = from + 1 + (b % (words.length - from));
        const quote = words.slice(from, to).join(" ");
        const match = matchQuote(quote, text);
        expect(match.kind).toBe("exact");
        expect(match.kind !== "missed" && text.includes(match.quote)).toBe(true);
      }),
    );
  });

  it("whatever the quote, a match never returns text that is not in the segment", () => {
    fc.assert(
      fc.property(paragraph, fc.string({ maxLength: 80 }), (text, quote) => {
        const match = matchQuote(quote, text);
        // A miss returns no text; anything returned must be in the segment.
        expect(match.kind === "missed" || text.includes(match.quote)).toBe(true);
      }),
    );
  });
});

describe("translation number check properties", () => {
  it("a translation that keeps every number passes; dropping a number fails", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 999_999 }), { minLength: 1, maxLength: 4 }),
        (numbers) => {
          const english = `Pay ${numbers.map((n) => `Rs. ${n.toLocaleString("en-IN")}`).join(" and ")} now.`;
          const kept = `भुगतान करें ${numbers.map((n) => `Rs. ${n.toLocaleString("en-IN")}`).join(" और ")}`;
          expect(keepsNumbers(english, kept)).toBe(true);
          expect(keepsNumbers(english, "भुगतान करें")).toBe(false);
        },
      ),
    );
  });
});
