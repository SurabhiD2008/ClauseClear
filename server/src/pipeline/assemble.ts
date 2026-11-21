// Assembles the draft analysis from merged findings and the synthesis: final
// ids (f1, c1, k1, q1, b1, a1, g1) and every reference remapped to them.
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
} from "@clauseclear/shared";
import type { DraftAnalysis, DraftFlag, MergedFindings } from "./merge.js";
import type {
  ModelChecklistItem,
  ModelGlossary,
  ModelKeyFact,
  ModelMissing,
  ModelQuestion,
} from "./modelOutput.js";

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

/** Present flags first, in document order, with every model ref pointing at its final id. */
function presentFlags(
  merged: MergedFindings,
  categoryName: Map<string, string>,
  refToId: Map<string, string>,
): DraftFlag[] {
  return merged.flags.map(({ flag, refs }, i) => {
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
}

/** Missing items after the present flags; unknown basics and repeats are dropped. */
function addMissing(
  flags: DraftFlag[],
  input: AssembleInput,
  categoryName: Map<string, string>,
  refToId: Map<string, string>,
): void {
  const { checklist, merged, synthesis } = input;
  const basics = new Map(checklist.missingBasics.map((b) => [b.id, b]));
  const seenBasics = new Set<string>();
  for (const item of synthesis.missing) {
    const basic = basics.get(item.basicId);
    // A basic whose category was found flagged is dropped too: the document does deal with it.
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
}

/** Up to MAX_GLOSSARY_TERMS distinct terms, then each flag tagged with the terms it uses. */
function glossaryFor(synthesis: SynthesisFindings, flags: DraftFlag[]): GlossaryEntry[] {
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
  return glossary;
}

/** Clause readings, each linked to the first flag on its segment. */
function clausesFor(merged: MergedFindings, flags: DraftFlag[]): Clause[] {
  const firstFlagFor = new Map<string, string>();
  for (const flag of flags) {
    if (flag.segmentId !== undefined && !firstFlagFor.has(flag.segmentId))
      firstFlagFor.set(flag.segmentId, flag.id);
  }
  return merged.clauses.map((clause, i) => {
    const flagId = firstFlagFor.get(clause.segmentId);
    return {
      id: `c${String(i + 1)}`,
      segmentId: clause.segmentId,
      heading: clause.heading,
      plain: clause.plain,
      ...(flagId === undefined ? {} : { flagId }),
    };
  });
}

export function assembleDraft(input: AssembleInput): DraftAnalysis {
  const { checklist, merged, synthesis } = input;
  const categoryName = new Map(checklist.categories.map((c) => [c.id, c.name]));
  const refToId = new Map<string, string>();
  const flags = presentFlags(merged, categoryName, refToId);
  addMissing(flags, input, categoryName, refToId);
  const resolve = (ref: string): string | undefined => {
    if (ref.startsWith("m")) return refToId.get(`missing:${ref}`);
    return input.flagRefs === "model" ? refToId.get(`0:${ref}`) : refToId.get(`final:${ref}`);
  };
  const glossary = glossaryFor(synthesis, flags);
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
    clauses: clausesFor(merged, flags),
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
