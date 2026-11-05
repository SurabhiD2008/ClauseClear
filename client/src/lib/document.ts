// Pure helpers for the results page: flag numbers, the document viewer's
// highlighted pieces, and glossary terms inside a piece of text.
import type { Flag, GlossaryEntry, Segment } from "@clauseclear/shared";
import { orderFlags } from "./flags";

/** A flag's number is its place in the ranked list (SPEC F7), the same in the list and the viewer. */
export function flagNumbers(flags: readonly Flag[]): Map<string, number> {
  return new Map(orderFlags(flags).map((flag, i) => [flag.id, i + 1]));
}

/** "s12" is clause 12 of the document as segmented. */
export function segmentNumber(segmentId: string): number {
  return Number(segmentId.slice(1));
}

export interface SegmentPart {
  text: string;
  /** Set on the quote of a present flag. */
  flagId?: string;
}

/**
 * Splits a segment into plain text and flag quotes, in reading order. Quotes are
 * exact substrings (the schema guarantees it); a quote that overlaps an earlier
 * one is left unmarked rather than nested.
 */
export function segmentParts(segment: Segment, flags: readonly Flag[]): SegmentPart[] {
  const ranges = flags
    .filter((f) => f.kind === "present" && f.segmentId === segment.id && f.quote !== undefined)
    .map((f) => {
      const quote = f.quote ?? "";
      const start = segment.text.indexOf(quote);
      return { start, end: start + quote.length, flagId: f.id };
    })
    .filter((r) => r.start >= 0)
    .sort((a, b) => a.start - b.start);

  const parts: SegmentPart[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start < at) continue;
    if (range.start > at) parts.push({ text: segment.text.slice(at, range.start) });
    parts.push({ text: segment.text.slice(range.start, range.end), flagId: range.flagId });
    at = range.end;
  }
  if (at < segment.text.length) parts.push({ text: segment.text.slice(at) });
  return parts;
}

/**
 * PDF text keeps the page's hard line wraps. For reading, a single line break
 * becomes a space and a blank line stays a paragraph break. Display only: quotes
 * are matched against the raw text.
 */
export function displayText(text: string): string {
  return text.replace(/(?<!\n)\n(?!\n)/g, " ");
}

export interface TextPart<T extends { term: string } = GlossaryEntry> {
  text: string;
  /** Set on a glossary term. */
  term?: T;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface TermHit<T> {
  start: number;
  end: number;
  term: T;
}

/**
 * Finds the first whole-word occurrence of each term in one paragraph (SPEC F18,
 * "underlined where they appear"). Matching ignores case; the text keeps its own
 * casing. A letter, digit or combining mark (Devanagari vowel signs) next to the
 * match means it is part of a longer word. Overlapping hits keep the earlier term.
 */
export function termHits<T extends { term: string }>(
  text: string,
  terms: readonly T[],
): TermHit<T>[] {
  const hits: TermHit<T>[] = [];
  for (const term of terms) {
    const match = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${escape(term.term)}(?![\\p{L}\\p{M}\\p{N}])`,
      "iu",
    ).exec(text);
    if (match === null) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (hits.some((h) => start < h.end && end > h.start)) continue;
    hits.push({ start, end, term });
  }
  return hits.sort((a, b) => a.start - b.start);
}

/**
 * Splits a piece of a paragraph that starts at `offset` into plain text and terms.
 * The hits come from termHits over the whole paragraph, so each term is marked once
 * per paragraph even when the paragraph is drawn in several pieces (the document
 * viewer's quotes); a hit that crosses a piece's edge is left unmarked.
 */
export function splitTerms<T extends { term: string }>(
  text: string,
  offset: number,
  hits: readonly TermHit<T>[],
): TextPart<T>[] {
  const parts: TextPart<T>[] = [];
  let at = 0;
  for (const hit of hits) {
    const start = hit.start - offset;
    const end = hit.end - offset;
    if (start < at || end > text.length) continue;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: text.slice(start, end), term: hit.term });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** One paragraph split into plain text and its glossary terms, each marked once. */
export function glossaryParts<T extends { term: string }>(
  text: string,
  terms: readonly T[],
): TextPart<T>[] {
  return splitTerms(text, 0, termHits(text, terms));
}
