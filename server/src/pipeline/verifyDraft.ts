// Applies the quote, number and glossary checks to a whole draft, renumbers the
// surviving flags and removes every reference to anything dropped.
import type { Segment } from "@clauseclear/shared";
import type { DraftAnalysis, DraftFlag } from "./merge.js";
import { fold, matchQuote, numbersIn } from "./verify.js";

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

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Checks one present flag's quote against the segment it cites. */
function checkFlag(
  flag: DraftFlag,
  bySegment: Map<string, Segment>,
  stats: VerificationStats,
): { outcome: FlagOutcome; kept?: DraftFlag } {
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
    const why =
      segment === undefined
        ? { reason: "unknown_segment" as const }
        : match === undefined
          ? { reason: "no_quote" as const }
          : { reason: "below_threshold" as const, similarity: round(match.similarity) };
    return { outcome: { ...base, outcome: "dropped", ...why } };
  }
  const kept = { ...flag, quote: match.quote };
  if (match.kind === "exact") {
    stats.exact += 1;
    return { outcome: { ...base, outcome: "kept", reason: "exact" }, kept };
  }
  stats.repaired += 1;
  const outcome: FlagOutcome = {
    ...base,
    outcome: "repaired",
    reason: "fuzzy",
    similarity: round(match.similarity),
  };
  return { outcome, kept };
}

/** Renumbers kept flags f1.. in order and records each outcome's final id. */
function renumber(kept: DraftFlag[], outcomes: FlagOutcome[]) {
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
  return { flags, renamed };
}

/** Key facts whose every number is in the document; a fact citing an unknown segment loses the citation. */
function checkKeyFacts(
  draft: DraftAnalysis,
  segments: Segment[],
  bySegment: Map<string, Segment>,
  stats: VerificationStats,
) {
  const docNumbers = new Set(numbersIn(segments.map((s) => s.text).join("\n\n")));
  return draft.keyFacts
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
}

/** Glossary terms that appear in the document. */
function checkGlossary(draft: DraftAnalysis, segments: Segment[], stats: VerificationStats) {
  const docFolded = fold(segments.map((s) => s.text).join("\n\n")).text;
  return draft.glossary.filter((entry) => {
    const ok = docFolded.includes(fold(entry.term).text);
    if (!ok) stats.termsDropped += 1;
    return ok;
  });
}

export function verifyDraft(draft: DraftAnalysis, segments: Segment[]): Verified {
  const bySegment = new Map(segments.map((s) => [s.id, s]));
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
  for (const flag of draft.flags) {
    if (flag.kind === "missing") {
      kept.push(flag);
      continue;
    }
    const checked = checkFlag(flag, bySegment, stats);
    outcomes.push(checked.outcome);
    if (checked.kept !== undefined) kept.push(checked.kept);
  }
  // Dropped ids vanish from every reference.
  const { flags, renamed } = renumber(kept, outcomes);
  const remap = (ids: string[]) =>
    ids.map((id) => renamed.get(id)).filter((id): id is string => id !== undefined);
  const glossary = checkGlossary(draft, segments, stats);
  const termIds = new Set(glossary.map((g) => g.id));
  const keyFacts = checkKeyFacts(draft, segments, bySegment, stats);
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
