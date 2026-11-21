// Cross-field rules of an analysis result, checked by the result schema: unique
// ids, every reference resolvable, quotes inside their segments, counts and the
// score consistent with the flags.
import type { z } from "zod";
import type { ResultShape } from "./schemas.js";
import { computeScore } from "./scoring.js";

type Issue = (message: string, path: (string | number)[]) => void;

/**
 * Ids are unique across every collection, so a key like "flags.f1" or a
 * checklist tick keyed by item id can never point at two things.
 */
function uniqueIds(r: ResultShape, issue: Issue): void {
  const seen = new Set<string>();
  const collections: [string, { id: string }[]][] = [
    ["segments", r.segments],
    ["keyFacts", r.keyFacts],
    ["flags", r.flags],
    ["clauses", r.clauses],
    ["questions", r.questions],
    ["checklist.before", r.checklist.before],
    ["checklist.after", r.checklist.after],
    ["glossary", r.glossary],
  ];
  for (const [name, items] of collections) {
    items.forEach((item, i) => {
      if (seen.has(item.id)) issue(`duplicate id "${item.id}"`, [...name.split("."), i, "id"]);
      seen.add(item.id);
    });
  }
}

/** Present flags cite a segment and quote it exactly; missing flags cite nothing. */
function flagRules(r: ResultShape, issue: Issue): void {
  const segments = new Map(r.segments.map((s) => [s.id, s]));
  const termIds = new Set(r.glossary.map((g) => g.id));
  r.flags.forEach((f, i) => {
    if (f.kind === "present") {
      if (f.segmentId === undefined || f.quote === undefined) {
        issue(`present flag ${f.id} needs segmentId and quote`, ["flags", i]);
      } else if (!segments.has(f.segmentId)) {
        issue(`unknown segmentId "${f.segmentId}"`, ["flags", i, "segmentId"]);
      } else if (!(segments.get(f.segmentId)?.text ?? "").includes(f.quote)) {
        // Verification repairs every surviving quote to the real text, so a
        // valid result's quote is an exact substring.
        issue(`quote of ${f.id} not found in segment ${f.segmentId}`, ["flags", i, "quote"]);
      }
    } else if (f.segmentId !== undefined || f.quote !== undefined) {
      issue(`missing flag ${f.id} must not have segmentId or quote`, ["flags", i]);
    }
    f.termIds.forEach((t, j) => {
      if (!termIds.has(t)) issue(`unknown termId "${t}"`, ["flags", i, "termIds", j]);
    });
  });
}

/** Every segmentId and flagId reference elsewhere in the result exists. */
function referenceRules(r: ResultShape, issue: Issue): void {
  const segments = new Set(r.segments.map((s) => s.id));
  const flagIds = new Set(r.flags.map((f) => f.id));
  const checkSegment = (id: string | undefined, path: (string | number)[]) => {
    if (id !== undefined && !segments.has(id)) issue(`unknown segmentId "${id}"`, path);
  };
  const checkFlag = (id: string | undefined, path: (string | number)[]) => {
    if (id !== undefined && !flagIds.has(id)) issue(`unknown flagId "${id}"`, path);
  };
  r.keyFacts.forEach((k, i) => {
    checkSegment(k.segmentId, ["keyFacts", i, "segmentId"]);
  });
  r.clauses.forEach((c, i) => {
    checkSegment(c.segmentId, ["clauses", i, "segmentId"]);
    checkFlag(c.flagId, ["clauses", i, "flagId"]);
  });
  r.questions.forEach((q, i) => {
    q.flagIds.forEach((id, j) => {
      checkFlag(id, ["questions", i, "flagIds", j]);
    });
  });
  for (const list of ["before", "after"] as const) {
    r.checklist[list].forEach((item, i) => {
      item.flagIds.forEach((id, j) => {
        checkFlag(id, ["checklist", list, i, "flagIds", j]);
      });
    });
  }
}

/** Counts, the score and the warnings agree with the rest of the result. */
function consistencyRules(r: ResultShape, issue: Issue): void {
  if (r.stats.segments !== r.segments.length) {
    issue("stats.segments must equal the number of segments", ["stats", "segments"]);
  }
  const expected = computeScore(r.flags);
  const actual = r.score;
  if (
    actual.value !== expected.value ||
    actual.band !== expected.band ||
    actual.counts.high !== expected.counts.high ||
    actual.counts.medium !== expected.counts.medium ||
    actual.counts.missing !== expected.counts.missing
  ) {
    issue(`score does not match the flags (expected ${JSON.stringify(expected)})`, ["score"]);
  }
  const warnings = new Set<string>();
  r.warnings.forEach((w, i) => {
    if (warnings.has(w)) issue(`duplicate warning "${w}"`, ["warnings", i]);
    warnings.add(w);
  });
}

export function checkInvariants(r: ResultShape, ctx: z.RefinementCtx): void {
  const issue: Issue = (message, path) => {
    ctx.addIssue({ code: "custom", message, path });
  };
  uniqueIds(r, issue);
  flagRules(r, issue);
  referenceRules(r, issue);
  consistencyRules(r, issue);
}
