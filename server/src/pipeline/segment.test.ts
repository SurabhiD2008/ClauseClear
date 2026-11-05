import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SEGMENT_MAX_CHARS } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { readPdf } from "./extract.js";
import {
  isCapsHeading,
  pageClauses,
  segmentDocument,
  sentenceEnds,
  splitLong,
  startsClause,
} from "./segment.js";

const docs = fileURLToPath(new URL("../../../fixtures/docs/", import.meta.url));
const fixture = async (name: string) => new Uint8Array(await readFile(`${docs}${name}`));

describe("clause boundaries", () => {
  it("recognises numbered, named, lettered and ALL-CAPS starts", () => {
    for (const line of [
      "4. Rent",
      "4.2 The rent",
      "12) Notices",
      "Clause 7 applies",
      "SECTION IV",
      "(a) the first",
      "(iv) the fourth",
      "b) the second",
      "SECURITY DEPOSIT",
    ]) {
      expect(startsClause(line), line).toBe(true);
    }
    for (const line of [
      "the rent is 4.5 percent",
      "Rs. 5,000 is due",
      "2026 was a year",
      "As per (a) above",
    ]) {
      expect(startsClause(line), line).toBe(false);
    }
  });

  it("treats short all-uppercase lines as headings", () => {
    expect(isCapsHeading("LOCK-IN PERIOD")).toBe(true);
    expect(isCapsHeading("4. TERMINATION")).toBe(true);
    expect(isCapsHeading("Termination")).toBe(false);
    expect(isCapsHeading("A")).toBe(false);
  });

  it("splits numbered clauses and items that run on without blank lines", () => {
    const text = [
      "4. TERMINATION",
      "4.1 The Licensee may leave with one month notice.",
      "4.2 The Licensor may end this agreement at any time,",
      "without giving any reason, by notice of seven days.",
      "(a) on breach of any term;",
      "(b) on non-payment of rent.",
    ].join("\n");
    expect(pageClauses(text)).toEqual([
      "4. TERMINATION\n4.1 The Licensee may leave with one month notice.",
      "4.2 The Licensor may end this agreement at any time,\nwithout giving any reason, by notice of seven days.",
      "(a) on breach of any term;",
      "(b) on non-payment of rent.",
    ]);
  });

  it("attaches a stand-alone heading to the clause below it", () => {
    expect(
      pageClauses("3. SECURITY DEPOSIT\n\n3.1 The deposit is Rs. 50,000.\n\n3.2 It is refundable."),
    ).toEqual(["3. SECURITY DEPOSIT\n\n3.1 The deposit is Rs. 50,000.", "3.2 It is refundable."]);
  });

  it("does not split at numbers inside a sentence", () => {
    const text = "The rent of Rs. 28,000 rises by 5.5 percent\n2 months after the start date.";
    expect(pageClauses(text)).toEqual([text]);
  });

  it("splits each numbered clause of the rental fixture into its own segment", async () => {
    const segments = segmentDocument((await readPdf(await fixture("rental.pdf"))).pages);
    for (const number of [
      "1.1",
      "1.2",
      "2.1",
      "2.2",
      "2.3",
      "3.1",
      "3.2",
      "5.2",
      "6.1",
      "8.2",
      "9.1",
    ]) {
      const holders = segments.filter((s) =>
        new RegExp(`(^|\\n)${number.replace(".", "\\.")} `).test(s.text),
      );
      expect(holders, number).toHaveLength(1);
    }
    for (const item of ["(a)", "(b)", "(c)", "(d)", "(e)"]) {
      expect(
        segments.filter((s) => s.text.includes(`${item} `)),
        item,
      ).toHaveLength(1);
    }
  });
});

describe("long paragraphs", () => {
  it("does not end a sentence at abbreviations or initials", () => {
    const text = "Pay Rs. 5,000 to Mr. A. Rao by 5 p.m. on the due date. Then sign.";
    expect(sentenceEnds(text)).toEqual([text.indexOf(" Then")]);
  });

  it("splits a paragraph over 900 characters at sentence ends", () => {
    const sentence = (n: number) =>
      `Sentence ${String(n)} of the clause says the tenant shall keep the flat clean and pay on time.`;
    const paragraph = Array.from({ length: 20 }, (_, n) => sentence(n + 1)).join(" ");
    expect(paragraph.length).toBeGreaterThan(SEGMENT_MAX_CHARS);
    const pieces = splitLong(paragraph);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
      expect(piece).toMatch(/^Sentence \d+ /);
      expect(piece.endsWith("on time.")).toBe(true);
    }
    expect(pieces.join(" ")).toBe(paragraph);
  });

  it("splits a single sentence over the limit at a space", () => {
    const sentence = `${"very ".repeat(250)}long.`;
    const pieces = splitLong(sentence);
    expect(pieces.every((piece) => piece.length <= SEGMENT_MAX_CHARS)).toBe(true);
    expect(pieces.join(" ")).toBe(sentence);
  });

  it("splits the long-paragraph fixture at sentence ends with nothing lost", async () => {
    const doc = await readPdf(await fixture("long-paragraph.pdf"));
    const segments = segmentDocument(doc.pages);
    const body = segments.filter((s) => !s.text.startsWith("GENERAL CONDITIONS"));
    expect(segments.length).toBeGreaterThan(2);
    for (const segment of segments) {
      expect(segment.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
      expect(segment.text.endsWith(".")).toBe(true);
    }
    expect(body.length).toBeGreaterThan(1);
    const words = (text: string) => text.split(/\s+/).join(" ");
    expect(words(segments.map((s) => s.text).join(" "))).toBe(words(doc.text));
  });
});

describe("segment ids", () => {
  it("numbers segments s1 to sN in reading order with page numbers", async () => {
    const doc = await readPdf(await fixture("employment.pdf"));
    const segments = segmentDocument(doc.pages);
    expect(segments.map((s) => s.id)).toEqual(segments.map((_, n) => `s${String(n + 1)}`));
    expect(segments[0]?.page).toBe(1);
    expect(segments.at(-1)?.page).toBe(doc.pageCount);
    const pages = segments.map((s) => s.page);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });

  it("gives every segment text that is an exact slice of its page", async () => {
    for (const name of ["rental.pdf", "employment.pdf", "loan.pdf", "terms.pdf"]) {
      const doc = await readPdf(await fixture(name));
      for (const segment of segmentDocument(doc.pages)) {
        const page = doc.pages.find((p) => p.page === segment.page);
        expect(page?.text.includes(segment.text), `${name} ${segment.id}`).toBe(true);
      }
    }
  });

  it("gives the same ids and text across runs", async () => {
    const bytes = await fixture("terms.pdf");
    const first = segmentDocument((await readPdf(bytes)).pages);
    const second = segmentDocument((await readPdf(bytes)).pages);
    expect(second).toEqual(first);
  });
});
