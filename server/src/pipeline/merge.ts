// Turns model answers into one draft analysis (SPEC section 6 step 7). Chunk
// answers are merged: flags are deduplicated by segment and category, clause
// readings by segment, key-fact candidates by label and value, and coverage
// keeps the strongest report per category. Then the draft is assembled with
// final ids (f1, c1, k1, q1, b1, a1, g1) and every reference remapped.
// Verification (step 8) and scoring (step 9) run on the draft afterwards.
import {
  MAX_GLOSSARY_TERMS,
  MAX_KEY_FACTS,
  MAX_QUESTIONS,
  type Checklist,
  type ChecklistItem,
  type Clause,
  type Confidence,
  type DocType,
  type GlossaryEntry,
  type KeyFact,
  type Question,
  type Severity,
} from "@clauseclear/shared";
import type {
  Coverage,
  CoverageStatus,
  ModelChecklistItem,
  ModelClause,
  ModelFlag,
  ModelGlossary,
  ModelKeyFact,
  ModelMissing,
  ModelQuestion,
} from "./modelOutput.js";

export interface DraftFlag {
  id: string;
  kind: "present" | "missing";
  severity: Severity;
  categoryId: string;
  /** The checklist category name, as AnalysisResult.flags[].category. */
  category: string;
  title: string;
  plain: string;
  why: string;
  segmentId?: string;
  quote?: string;
  severityReason?: string;
  termIds: string[];
}

export interface DraftAnalysis {
  docType: DocType;
  docTypeLabel: string;
  docTypeConfidence: Confidence;
  title: string;
  summary: string;
  flags: DraftFlag[];
  clauses: Clause[];
  keyFacts: KeyFact[];
  questions: Question[];
  checklist: { before: ChecklistItem[]; after: ChecklistItem[] };
  glossary: GlossaryEntry[];
  /** Every checklist category with the strongest report; "absent" when nothing reported it. */
  coverage: Record<string, CoverageStatus>;
  path: "single" | "chunked" | "small-chunks";
  /** Model calls made by the analysis (not counting type detection). */
  calls: number;
}

/** A flag kept by the merge, with the model refs that point at it. */
export interface MergedFlag {
  flag: ModelFlag;
  /** "part:id" for every model flag folded into this one. */
  refs: string[];
}

export interface ChunkFindings {
  part: number;
  coverage: Coverage[];
  flags: ModelFlag[];
  clauses: ModelClause[];
  keyFacts: ModelKeyFact[];
}

export interface MergedFindings {
  /** Present flags in document order, deduplicated; final ids are f1.. in this order. */
  flags: MergedFlag[];
  clauses: ModelClause[];
  keyFacts: ModelKeyFact[];
  coverage: Record<string, CoverageStatus>;
  /** Categories that no part reported as flagged or fine. */
  uncovered: string[];
}

const STATUS_RANK: Record<CoverageStatus, number> = { absent: 0, fine: 1, flagged: 2 };
const SEVERITY_RANK: Record<Severity, number> = { medium: 0, high: 1 };

/** "s12" -> 12, for document order. */
function segmentNumber(id: string): number {
  return Number(id.slice(1));
}

/**
 * Keeps the category default unless the model gave a reason for moving it
 * (SPEC section 8: "may move it one level with a stated reason"). Severities
 * have two levels, so any change is one level. Unknown categories are dropped.
 */
export function normalizeFlag(flag: ModelFlag, checklist: Checklist): ModelFlag | undefined {
  const category = checklist.categories.find((c) => c.id === flag.categoryId);
  if (category === undefined) return undefined;
  const reason = flag.severityReason?.trim() ?? "";
  if (flag.severity !== category.severity && reason === "") {
    return { ...flag, severity: category.severity };
  }
  return flag;
}

export function mergeChunks(chunks: ChunkFindings[], checklist: Checklist): MergedFindings {
  const ordered = [...chunks].sort((a, b) => a.part - b.part);

  const byKey = new Map<string, MergedFlag>();
  for (const chunk of ordered) {
    for (const raw of chunk.flags) {
      const flag = normalizeFlag(raw, checklist);
      if (flag === undefined) continue;
      const key = `${flag.segmentId}|${flag.categoryId}`;
      const ref = `${String(chunk.part)}:${raw.id}`;
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, { flag, refs: [ref] });
      } else {
        existing.refs.push(ref);
        // The same term found twice (chunks never overlap, so this is a repeat
        // inside one answer): keep the higher severity, else the first.
        if (SEVERITY_RANK[flag.severity] > SEVERITY_RANK[existing.flag.severity])
          existing.flag = flag;
      }
    }
  }
  const flags = [...byKey.values()].sort(
    (a, b) => segmentNumber(a.flag.segmentId) - segmentNumber(b.flag.segmentId),
  );

  const clauses = new Map<string, ModelClause>();
  for (const chunk of ordered) {
    for (const clause of chunk.clauses)
      if (!clauses.has(clause.segmentId)) clauses.set(clause.segmentId, clause);
  }

  const facts = new Map<string, ModelKeyFact>();
  for (const chunk of ordered) {
    for (const fact of chunk.keyFacts) {
      const key = `${fact.label.toLowerCase().trim()}|${fact.value.toLowerCase().replace(/\s+/g, " ").trim()}`;
      if (!facts.has(key)) facts.set(key, fact);
    }
  }

  const known = new Set(checklist.categories.map((c) => c.id));
  const coverage: Record<string, CoverageStatus> = {};
  for (const category of checklist.categories) coverage[category.id] = "absent";
  for (const chunk of ordered) {
    for (const report of chunk.coverage) {
      if (!known.has(report.categoryId)) continue;
      const current = coverage[report.categoryId] ?? "absent";
      if (STATUS_RANK[report.status] > STATUS_RANK[current])
        coverage[report.categoryId] = report.status;
    }
  }
  // A category with a surviving flag is flagged, whatever coverage said.
  for (const { flag } of flags) coverage[flag.categoryId] = "flagged";

  return {
    flags,
    clauses: [...clauses.values()].sort(
      (a, b) => segmentNumber(a.segmentId) - segmentNumber(b.segmentId),
    ),
    keyFacts: [...facts.values()],
    coverage,
    uncovered: checklist.categories.filter((c) => coverage[c.id] === "absent").map((c) => c.id),
  };
}

export interface SynthesisFindings {
  summary: string;
  keyFacts: ModelKeyFact[];
  missing: ModelMissing[];
  questions: ModelQuestion[];
  checklist: { before: ModelChecklistItem[]; after: ModelChecklistItem[] };
  glossary: ModelGlossary[];
}

export interface AssembleInput {
  checklist: Checklist;
  docType: DocType;
  docTypeLabel: string;
  docTypeConfidence: Confidence;
  title: string;
  merged: MergedFindings;
  synthesis: SynthesisFindings;
  /**
   * How "f" refs in questions and checklist items are written: "model" for the
   * single path (refs are the model's own f-ids in part 0), "final" for the
   * chunked path (the synthesis call saw final ids).
   */
  flagRefs: "model" | "final";
  path: DraftAnalysis["path"];
  calls: number;
}

function mapRefs(refs: string[], resolve: (ref: string) => string | undefined): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    const id = resolve(ref);
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

export function assembleDraft(input: AssembleInput): DraftAnalysis {
  const { checklist, merged, synthesis } = input;
  const categoryName = new Map(checklist.categories.map((c) => [c.id, c.name]));

  // Present flags first, in document order, then missing items.
  const refToId = new Map<string, string>();
  const flags: DraftFlag[] = merged.flags.map(({ flag, refs }, i) => {
    const id = `f${String(i + 1)}`;
    for (const ref of refs) refToId.set(ref, id);
    refToId.set(`final:${id}`, id);
    return {
      id,
      kind: "present",
      severity: flag.severity,
      categoryId: flag.categoryId,
      category: categoryName.get(flag.categoryId) ?? flag.categoryId,
      title: flag.title,
      plain: flag.plain,
      why: flag.why,
      segmentId: flag.segmentId,
      quote: flag.quote,
      ...(flag.severityReason === undefined ? {} : { severityReason: flag.severityReason }),
      termIds: [],
    };
  });

  const basics = new Map(checklist.missingBasics.map((b) => [b.id, b]));
  const seenBasics = new Set<string>();
  for (const item of synthesis.missing) {
    const basic = basics.get(item.basicId);
    // Unknown basics and repeats are dropped; so is a basic whose category was
    // found flagged, since the document does deal with it.
    if (
      basic === undefined ||
      seenBasics.has(basic.id) ||
      merged.coverage[basic.categoryId] === "flagged"
    )
      continue;
    seenBasics.add(basic.id);
    const id = `f${String(flags.length + 1)}`;
    refToId.set(`missing:${item.id}`, id);
    flags.push({
      id,
      kind: "missing",
      severity: basic.severity,
      categoryId: basic.categoryId,
      category: categoryName.get(basic.categoryId) ?? basic.categoryId,
      title: item.title,
      plain: item.plain,
      why: item.why,
      termIds: [],
    });
  }

  const resolve = (ref: string): string | undefined => {
    if (ref.startsWith("m")) return refToId.get(`missing:${ref}`);
    return input.flagRefs === "model" ? refToId.get(`0:${ref}`) : refToId.get(`final:${ref}`);
  };

  const glossary: GlossaryEntry[] = [];
  for (const entry of synthesis.glossary) {
    if (glossary.length >= MAX_GLOSSARY_TERMS) break;
    if (glossary.some((g) => g.term.toLowerCase() === entry.term.toLowerCase())) continue;
    glossary.push({
      id: `g${String(glossary.length + 1)}`,
      term: entry.term,
      definition: entry.definition,
    });
  }
  for (const flag of flags) {
    const text = [flag.title, flag.plain, flag.why, flag.quote ?? ""].join(" ").toLowerCase();
    flag.termIds = glossary.filter((g) => text.includes(g.term.toLowerCase())).map((g) => g.id);
  }

  const firstFlagFor = new Map<string, string>();
  for (const flag of flags) {
    if (flag.segmentId !== undefined && !firstFlagFor.has(flag.segmentId))
      firstFlagFor.set(flag.segmentId, flag.id);
  }
  const clauses: Clause[] = merged.clauses.map((clause, i) => {
    const flagId = firstFlagFor.get(clause.segmentId);
    return {
      id: `c${String(i + 1)}`,
      segmentId: clause.segmentId,
      heading: clause.heading,
      plain: clause.plain,
      ...(flagId === undefined ? {} : { flagId }),
    };
  });

  const keyFacts: KeyFact[] = synthesis.keyFacts.slice(0, MAX_KEY_FACTS).map((fact, i) => ({
    id: `k${String(i + 1)}`,
    label: fact.label,
    value: fact.value,
    ...(fact.segmentId === undefined ? {} : { segmentId: fact.segmentId }),
  }));

  const questions: Question[] = synthesis.questions.slice(0, MAX_QUESTIONS).map((q, i) => ({
    id: `q${String(i + 1)}`,
    text: q.text,
    flagIds: mapRefs(q.refs, resolve),
  }));

  const items = (list: ModelChecklistItem[], prefix: string): ChecklistItem[] =>
    list.map((item, i) => ({
      id: `${prefix}${String(i + 1)}`,
      text: item.text,
      flagIds: mapRefs(item.refs, resolve),
    }));

  return {
    docType: input.docType,
    docTypeLabel: input.docTypeLabel,
    docTypeConfidence: input.docTypeConfidence,
    title: input.title,
    summary: synthesis.summary,
    flags,
    clauses,
    keyFacts,
    questions,
    checklist: {
      before: items(synthesis.checklist.before, "b"),
      after: items(synthesis.checklist.after, "a"),
    },
    glossary,
    coverage: merged.coverage,
    path: input.path,
    calls: input.calls,
  };
}
