// The trust step. The model proposes; this file checks.
//   - A present flag survives only if its segmentId exists and its quote is a
//     substring of that segment after normalising whitespace, quotes and case.
//   - A near miss (token similarity >= QUOTE_FUZZY_MIN_SIMILARITY against the
//     best window of the segment) is repaired to the segment's real text.
//   - Every surviving quote is replaced by the exact slice of the segment, so
//     the viewer can highlight it and the schema check holds.
//   - Every number in a key fact must appear in the document, or the fact goes.
//   - Glossary terms must appear in the document, or they go.
// References to anything dropped are removed, and flags are renumbered.
import { QUOTE_FUZZY_MIN_SIMILARITY } from "@clauseclear/shared";

/** Text in match form, plus where each match-form character came from in the original. */
interface Folded {
  text: string;
  /** map[i] is the index in the original of folded character i. */
  map: number[];
}

const SINGLE_QUOTES = /[‘’‚‛′‵`]/;
const DOUBLE_QUOTES = /[“”„‟″‶«»]/;

/** Lowercase, quote marks unified, every run of whitespace one space, trimmed. */
export function fold(input: string): Folded {
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i += 1) {
    let ch = input[i] ?? "";
    if (/\s/.test(ch)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += " ";
      map.push(i);
      pendingSpace = false;
    }
    if (SINGLE_QUOTES.test(ch)) ch = "'";
    else if (DOUBLE_QUOTES.test(ch)) ch = '"';
    text += ch.toLowerCase();
    map.push(i);
  }
  return { text, map };
}

/** Models sometimes wrap a quote in quote marks or end it with "...". */
function trimQuote(quote: string): string {
  return quote
    .normalize("NFKC")
    .trim()
    .replace(/^["'‘’“”]+|["'‘’“”]+$/g, "")
    .replace(/(?:\.\.\.|…)$/, "")
    .trim();
}

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokens(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    word: m[0].toLowerCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** Dice similarity of two token multisets: 2 * shared / (|a| + |b|). */
export function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const word of a) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of b) {
    const n = counts.get(word) ?? 0;
    if (n > 0) {
      shared += 1;
      counts.set(word, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

export type QuoteMatch =
  | { kind: "exact"; quote: string }
  | { kind: "repaired"; quote: string; similarity: number }
  | { kind: "missed"; similarity: number };

/** Checks one quote against one segment's text. */
export function matchQuote(quote: string, segmentText: string): QuoteMatch {
  const wanted = fold(trimQuote(quote)).text;
  if (wanted === "") return { kind: "missed", similarity: 0 };
  const haystack = fold(segmentText);
  const at = haystack.text.indexOf(wanted);
  if (at !== -1) {
    const start = haystack.map[at] ?? 0;
    const end = (haystack.map[at + wanted.length - 1] ?? start) + 1;
    return { kind: "exact", quote: segmentText.slice(start, end) };
  }

  // Fuzzy: the best window of the segment, sized like the quote, give or take one word.
  const q = tokens(wanted).map((t) => t.word);
  const seg = tokens(segmentText);
  if (q.length === 0 || seg.length === 0) return { kind: "missed", similarity: 0 };
  let best = { similarity: 0, from: 0, to: 0 };
  for (let size = Math.max(1, q.length - 1); size <= q.length + 1; size += 1) {
    for (let from = 0; from + size <= seg.length; from += 1) {
      const window = seg.slice(from, from + size).map((t) => t.word);
      const similarity = tokenSimilarity(q, window);
      if (similarity > best.similarity) best = { similarity, from, to: from + size };
    }
  }
  if (best.similarity >= QUOTE_FUZZY_MIN_SIMILARITY) {
    const first = seg[best.from];
    const last = seg[best.to - 1];
    if (first !== undefined && last !== undefined) {
      return {
        kind: "repaired",
        quote: segmentText.slice(first.start, last.end),
        similarity: best.similarity,
      };
    }
  }
  return { kind: "missed", similarity: best.similarity };
}

/** Digit groups in a value, separators removed: "Rs. 2,80,000" -> ["280000"], "1.5%" -> ["1.5"]. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, ""));
}

export {
  verifyDraft,
  type FlagOutcome,
  type VerificationStats,
  type Verified,
} from "./verifyDraft.js";
