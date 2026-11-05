// SPEC section 6 step 4: split the normalised text into clause segments.
// Boundaries: blank lines, numbered headings ("4.", "4.2", "Clause 7"), "(a)"
// items and ALL-CAPS headings. Anything over SEGMENT_MAX_CHARS is split at
// sentence ends. Ids are s1, s2, ... in reading order, so the same text always
// gets the same ids. Every segment's text is an exact slice of its page's text,
// so quotes verified against a segment are text the user can see.
import { SEGMENT_MAX_CHARS, type Segment } from "@clauseclear/shared";
import type { PageText } from "./extract.js";

const NUMBERED = /^(?:\d{1,3}(?:\.\d{1,3})*[.)]|\d{1,3}(?:\.\d{1,3})+)\s+\S/;
const NAMED =
  /^(?:clause|section|article|schedule|annexure|appendix|part)\s+(?:\d{1,3}|[ivxlc]{1,6}|[a-z])\b/i;
const ITEM = /^\((?:[a-z]{1,2}|[ivx]{1,5}|\d{1,2})\)\s+\S|^[a-z]\)\s+\S/i;

/** ALL-CAPS heading: at least 3 letters, no lowercase letter, short. */
export function isCapsHeading(line: string): boolean {
  const letters = line.replace(/[^\p{L}]/gu, "");
  return (
    letters.length >= 3 &&
    line.length <= 80 &&
    letters === letters.toUpperCase() &&
    /\p{Lu}/u.test(letters)
  );
}

/** Does this line begin a new clause? */
export function startsClause(line: string): boolean {
  return NUMBERED.test(line) || NAMED.test(line) || ITEM.test(line) || isCapsHeading(line);
}

/** A block that is only a heading attaches to the clause below it. */
function isHeadingOnly(block: string): boolean {
  if (block.includes("\n") || block.length > 80) return false;
  if (isCapsHeading(block)) return true;
  // "4. SECURITY DEPOSIT" or "Clause 7" with no sentence after it.
  return (
    (NUMBERED.test(block) || NAMED.test(block)) &&
    !/[.;:]\s+\S/.test(block.replace(/^[\d.)\s]+/, ""))
  );
}

const ABBREVIATIONS = new Set([
  "rs",
  "no",
  "nos",
  "mr",
  "mrs",
  "ms",
  "dr",
  "sr",
  "jr",
  "st",
  "co",
  "ltd",
  "inc",
  "pvt",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "cl",
  "sec",
  "art",
  "para",
  "approx",
  "viz",
  "p",
  "pp",
  "fig",
  "govt",
  "dept",
  "u.s",
  "a.m",
  "p.m",
  "sch",
  "max",
  "min",
  "incl",
]);

/** Indexes just after each sentence-ending punctuation mark that is followed by a new sentence. */
export function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  const pattern = /[.!?]["')\]]*(?=\s+["'(\[]?[\p{Lu}\d])/gu;
  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    if (match[0].startsWith(".")) {
      const word =
        /([\p{L}.]+)$/u.exec(text.slice(Math.max(0, at - 12), at))?.[1]?.toLowerCase() ?? "";
      // Initials ("A. Rao") and known abbreviations ("Rs. 5,000") do not end a sentence.
      if (word.length === 1 || ABBREVIATIONS.has(word)) continue;
    }
    ends.push(at + match[0].length);
  }
  return ends;
}

/** Splits text over max characters at sentence ends; a sentence over max splits at a space. */
export function splitLong(text: string, max = SEGMENT_MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  const ends = sentenceEnds(text);
  const pieces: string[] = [];
  let start = 0;
  while (text.length - start > max) {
    const limit = start + max;
    let cut = [...ends].reverse().find((end) => end > start && end <= limit);
    if (cut === undefined) {
      const space = text.lastIndexOf(" ", limit);
      cut = space > start ? space : limit;
    }
    pieces.push(text.slice(start, cut).trim());
    start = cut;
    while (start < text.length && /\s/.test(text[start] ?? "")) start += 1;
  }
  if (start < text.length) pieces.push(text.slice(start).trim());
  return pieces.filter((piece) => piece !== "");
}

/** Clause texts of one page, in order. */
export function pageClauses(text: string): string[] {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== "");

  // Split each block before every line that starts a clause.
  const pieces: string[] = [];
  for (const block of blocks) {
    let current: string[] = [];
    for (const line of block.split("\n")) {
      if (current.length > 0 && startsClause(line) && !isCapsHeading(current.join("\n"))) {
        pieces.push(current.join("\n"));
        current = [];
      }
      current.push(line);
    }
    if (current.length > 0) pieces.push(current.join("\n"));
  }

  // Attach stand-alone headings to the clause that follows them.
  const merged: string[] = [];
  let pendingHeading: string | undefined;
  for (const piece of pieces) {
    if (isHeadingOnly(piece)) {
      pendingHeading = pendingHeading === undefined ? piece : `${pendingHeading}\n\n${piece}`;
      continue;
    }
    merged.push(pendingHeading === undefined ? piece : `${pendingHeading}\n\n${piece}`);
    pendingHeading = undefined;
  }
  if (pendingHeading !== undefined) merged.push(pendingHeading);

  return merged.flatMap((clause) => splitLong(clause));
}

export function segmentDocument(pages: PageText[]): Segment[] {
  const segments: Segment[] = [];
  for (const { page, text } of pages) {
    for (const clause of pageClauses(text)) {
      segments.push({ id: `s${String(segments.length + 1)}`, page, text: clause });
    }
  }
  return segments;
}
