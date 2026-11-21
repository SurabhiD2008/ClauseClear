// Turns model answers into one draft analysis. Chunk
// answers are merged: flags are deduplicated by segment and category, clause
// readings by segment, key-fact candidates by label and value, and coverage
// keeps the strongest report per category. Then the draft is assembled with
// final ids (f1, c1, k1, q1, b1, a1, g1) and every reference remapped
// (assemble.ts). Verification and scoring run on the draft afterwards.
import {
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
  ModelClause,
  ModelFlag,
  ModelKeyFact,
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
 * Keeps the category default unless the model gave a reason for moving it.
 * Severities
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

export { assembleDraft, type AssembleInput, type SynthesisFindings } from "./assemble.js";
