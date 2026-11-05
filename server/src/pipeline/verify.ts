// SPEC section 6 step 8, the trust step. The model proposes; this file checks.
//   - A present flag survives only if its segmentId exists and its quote is a
//     substring of that segment after normalising whitespace, quotes and case.
//   - A near miss (token similarity >= QUOTE_FUZZY_MIN_SIMILARITY against the
//     best window of the segment) is repaired to the segment's real text.
//   - Every surviving quote is replaced by the exact slice of the segment, so
//     the viewer can highlight it and the schema check holds.
//   - Every number in a key fact must appear in the document, or the fact goes.
//   - Glossary terms must appear in the document, or they go.
// References to anything dropped are removed, and flags are renumbered.
import { QUOTE_FUZZY_MIN_SIMILARITY, type Segment } from "@clauseclear/shared";
import type { DraftAnalysis, DraftFlag } from "./merge.js";

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

/** Checks one quote against one segment's text (SPEC section 6 step 8). */
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

export interface VerificationStats {
  /** Present flags the model proposed. */
  checked: number;
  exact: number;
  repaired: number;
  dropped: number;
  keyFactsDropped: number;
  termsDropped: number;
}

/** What happened to one proposed present flag. Ids, categories and numbers only, never text. */
export interface FlagOutcome {
  /** The flag's id in the draft, before renumbering. */
  draftId: string;
  /** Its id in the result, when kept. */
  finalId?: string;
  categoryId: string;
  severity: DraftFlag["severity"];
  segmentId?: string;
  outcome: "kept" | "repaired" | "dropped";
  reason: "exact" | "fuzzy" | "unknown_segment" | "no_quote" | "below_threshold";
  /** Best token similarity, for fuzzy and below_threshold. */
  similarity?: number;
}

export interface Verified {
  draft: DraftAnalysis;
  stats: VerificationStats;
  outcomes: FlagOutcome[];
  /** Share of present flags that failed (0 when there were none). */
  failRatio: number;
}

export function verifyDraft(draft: DraftAnalysis, segments: Segment[]): Verified {
  const bySegment = new Map(segments.map((s) => [s.id, s]));
  const docText = segments.map((s) => s.text).join("\n\n");
  const docFolded = fold(docText).text;
  const docNumbers = new Set(numbersIn(docText));
  const stats: VerificationStats = {
    checked: 0,
    exact: 0,
    repaired: 0,
    dropped: 0,
    keyFactsDropped: 0,
    termsDropped: 0,
  };

  const kept: DraftFlag[] = [];
  const outcomes: FlagOutcome[] = [];
  const round = (n: number) => Math.round(n * 1000) / 1000;
  for (const flag of draft.flags) {
    if (flag.kind === "missing") {
      kept.push(flag);
      continue;
    }
    stats.checked += 1;
    const segment = flag.segmentId === undefined ? undefined : bySegment.get(flag.segmentId);
    const match =
      segment === undefined || flag.quote === undefined
        ? undefined
        : matchQuote(flag.quote, segment.text);
    const base = {
      draftId: flag.id,
      categoryId: flag.categoryId,
      severity: flag.severity,
      ...(flag.segmentId === undefined ? {} : { segmentId: flag.segmentId }),
    };
    if (match === undefined || match.kind === "missed") {
      stats.dropped += 1;
      outcomes.push({
        ...base,
        outcome: "dropped",
        ...(segment === undefined
          ? { reason: "unknown_segment" as const }
          : match === undefined
            ? { reason: "no_quote" as const }
            : { reason: "below_threshold" as const, similarity: round(match.similarity) }),
      });
      continue;
    }
    if (match.kind === "exact") {
      stats.exact += 1;
      outcomes.push({ ...base, outcome: "kept", reason: "exact" });
    } else {
      stats.repaired += 1;
      outcomes.push({
        ...base,
        outcome: "repaired",
        reason: "fuzzy",
        similarity: round(match.similarity),
      });
    }
    kept.push({ ...flag, quote: match.quote });
  }

  // Renumber f1.. in order and remap every reference; dropped ids vanish.
  const renamed = new Map<string, string>();
  const flags = kept.map((flag, i) => {
    const id = `f${String(i + 1)}`;
    renamed.set(flag.id, id);
    return { ...flag, id };
  });
  for (const outcome of outcomes) {
    const finalId = renamed.get(outcome.draftId);
    if (finalId !== undefined) outcome.finalId = finalId;
  }
  const remap = (ids: string[]) =>
    ids.map((id) => renamed.get(id)).filter((id): id is string => id !== undefined);

  const glossary = draft.glossary.filter((entry) => {
    const ok = docFolded.includes(fold(entry.term).text);
    if (!ok) stats.termsDropped += 1;
    return ok;
  });
  const termIds = new Set(glossary.map((g) => g.id));

  const keyFacts = draft.keyFacts
    .filter((fact) => {
      const ok = numbersIn(fact.value).every((n) => docNumbers.has(n));
      if (!ok) stats.keyFactsDropped += 1;
      return ok;
    })
    .map((fact) =>
      fact.segmentId === undefined || bySegment.has(fact.segmentId)
        ? fact
        : { id: fact.id, label: fact.label, value: fact.value },
    );

  const clauses = draft.clauses
    .filter((c) => bySegment.has(c.segmentId))
    .map((c) => {
      const flagId = c.flagId === undefined ? undefined : renamed.get(c.flagId);
      const base = { id: c.id, segmentId: c.segmentId, heading: c.heading, plain: c.plain };
      return flagId === undefined ? base : { ...base, flagId };
    });

  return {
    draft: {
      ...draft,
      flags: flags.map((f) => ({ ...f, termIds: f.termIds.filter((t) => termIds.has(t)) })),
      glossary,
      keyFacts,
      clauses,
      questions: draft.questions.map((q) => ({ ...q, flagIds: remap(q.flagIds) })),
      checklist: {
        before: draft.checklist.before.map((item) => ({ ...item, flagIds: remap(item.flagIds) })),
        after: draft.checklist.after.map((item) => ({ ...item, flagIds: remap(item.flagIds) })),
      },
    },
    stats,
    outcomes,
    failRatio: stats.checked === 0 ? 0 : stats.dropped / stats.checked,
  };
}
