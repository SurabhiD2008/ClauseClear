import type { Flag, GlossaryEntry, Segment } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import {
  displayText,
  flagNumbers,
  glossaryParts,
  segmentNumber,
  segmentParts,
  splitTerms,
  termHits,
} from "./document";

const flag = (over: Partial<Flag> & Pick<Flag, "id">): Flag => ({
  kind: "present",
  severity: "medium",
  category: "c",
  title: "t",
  plain: "p",
  why: "w",
  termIds: [],
  ...over,
});

const segment: Segment = { id: "s4", page: 1, text: "Alpha beta gamma delta epsilon." };

describe("flagNumbers", () => {
  it("numbers flags in ranked order: high, medium, then missing", () => {
    const flags = [
      flag({ id: "f1", kind: "missing", severity: "high" }),
      flag({ id: "f2", severity: "medium", segmentId: "s1", quote: "x" }),
      flag({ id: "f3", severity: "high", segmentId: "s1", quote: "x" }),
    ];
    expect([...flagNumbers(flags)]).toEqual([
      ["f3", 1],
      ["f2", 2],
      ["f1", 3],
    ]);
  });
});

describe("segmentNumber", () => {
  it("reads the number from the id", () => {
    expect(segmentNumber("s1")).toBe(1);
    expect(segmentNumber("s34")).toBe(34);
  });
});

describe("segmentParts", () => {
  it("splits around each quote of a present flag in that segment", () => {
    const flags = [
      flag({ id: "f2", segmentId: "s4", quote: "delta" }),
      flag({ id: "f1", segmentId: "s4", quote: "beta" }),
      flag({ id: "f3", segmentId: "s9", quote: "Alpha" }),
      flag({ id: "f4", kind: "missing" }),
    ];
    expect(segmentParts(segment, flags)).toEqual([
      { text: "Alpha " },
      { text: "beta", flagId: "f1" },
      { text: " gamma " },
      { text: "delta", flagId: "f2" },
      { text: " epsilon." },
    ]);
  });

  it("keeps every character, and leaves an overlapping quote unmarked", () => {
    const flags = [
      flag({ id: "f1", segmentId: "s4", quote: "beta gamma" }),
      flag({ id: "f2", segmentId: "s4", quote: "gamma delta" }),
    ];
    const parts = segmentParts(segment, flags);
    expect(parts.map((p) => p.text).join("")).toBe(segment.text);
    expect(parts.filter((p) => p.flagId !== undefined).map((p) => p.flagId)).toEqual(["f1"]);
  });

  it("returns the whole text when nothing is quoted", () => {
    expect(segmentParts(segment, [])).toEqual([{ text: segment.text }]);
  });
});

describe("displayText", () => {
  it("joins hard line wraps and keeps blank lines as paragraph breaks", () => {
    expect(displayText("one\ntwo\n\nthree\nfour")).toBe("one two\n\nthree four");
    expect(displayText("no breaks")).toBe("no breaks");
  });
});

describe("glossaryParts", () => {
  const lockIn: GlossaryEntry = { id: "g1", term: "Lock-in period", definition: "d" };
  const licensee: GlossaryEntry = { id: "g2", term: "Licensee", definition: "d" };

  it("marks the first whole-word match of each term, ignoring case", () => {
    const text = "If the Licensee leaves during the lock-in period, the licensee pays.";
    const parts = glossaryParts(text, [lockIn, licensee]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.term).map((p) => [p.text, p.term?.id])).toEqual([
      ["Licensee", "g2"],
      ["lock-in period", "g1"],
    ]);
  });

  it("does not match inside a longer word", () => {
    const parts = glossaryParts("The sublicensee pays.", [licensee]);
    expect(parts).toEqual([{ text: "The sublicensee pays." }]);
  });

  it("treats regex characters in a term literally", () => {
    const odd: GlossaryEntry = { id: "g3", term: "EMI (monthly)", definition: "d" };
    const parts = glossaryParts("Pay the EMI (monthly) on time.", [odd]);
    expect(parts[1]).toEqual({ text: "EMI (monthly)", term: odd });
  });
});

describe("termHits and splitTerms", () => {
  const terms = [
    { id: "g1", term: "lock-in period" },
    { id: "g2", term: "Licensee" },
  ];

  it("marks each term once per paragraph, at its first whole-word match", () => {
    const text =
      "The Licensee pays. The licensee also serves the Lock-in period, and the lock-in period again.";
    const hits = termHits(text, terms);
    expect(hits.map((h) => [h.term.id, text.slice(h.start, h.end)])).toEqual([
      ["g2", "Licensee"],
      ["g1", "Lock-in period"],
    ]);
  });

  it("does not match inside a longer word, including a Devanagari vowel sign", () => {
    expect(termHits("Licensees only", terms)).toHaveLength(0);
    expect(termHits("किराया किरायेदार", [{ id: "h", term: "किराय" }])).toHaveLength(0);
    expect(termHits("यह किराया है", [{ id: "h", term: "किराया" }])).toHaveLength(1);
  });

  it("splits a piece of a paragraph at its own offset and skips a hit across its edge", () => {
    const text = "Alpha Licensee beta lock-in period.";
    const hits = termHits(text, terms);
    const cut = text.indexOf("beta");
    const first = splitTerms(text.slice(0, cut), 0, hits);
    const second = splitTerms(text.slice(cut), cut, hits);
    expect(first.map((p) => p.term?.id ?? p.text)).toEqual(["Alpha ", "g2", " "]);
    expect(second.map((p) => p.term?.id ?? p.text)).toEqual(["beta ", "g1", "."]);
    // The pieces put back together are the paragraph.
    expect([...first, ...second].map((p) => p.text).join("")).toBe(text);
    const mid = text.indexOf("period");
    expect(splitTerms(text.slice(mid), mid, hits).every((p) => p.term === undefined)).toBe(true);
  });
});
