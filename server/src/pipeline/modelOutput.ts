// What the model is asked to return (SPEC section 6 steps 5 to 7). These are
// the server's internal contracts with the model, not the public API: the
// public AnalysisResult in /shared is assembled from them in code. Objects
// strip unknown keys, because models add fields; every length limit matches the
// public schema so nothing has to be cut later (ASSUMPTIONS A73).
import {
  CONFIDENCES,
  DOC_TYPES,
  EXPLANATION_MAX_CHARS,
  SEVERITIES,
  TITLE_MAX_CHARS,
} from "@clauseclear/shared";
import { z } from "zod";

const title = z.string().trim().min(1).max(TITLE_MAX_CHARS);
const explanation = z.string().trim().min(1).max(EXPLANATION_MAX_CHARS);
const segmentId = z.string().regex(/^s[1-9]\d*$/);
/** The model's own reference for a flag ("f3") or a missing item ("m2"). */
const flagRef = z.string().regex(/^[fm][1-9]\d*$/);
const categoryId = z.string().min(1).max(60);

export const COVERAGE_STATUSES = ["flagged", "fine", "absent"] as const;

/** One report per checklist category: flagged, fine (present and acceptable) or absent. */
export const coverageSchema = z.object({
  categoryId,
  status: z.enum(COVERAGE_STATUSES),
});

export const modelFlagSchema = z.object({
  id: z.string().regex(/^f[1-9]\d*$/),
  categoryId,
  severity: z.enum(SEVERITIES),
  /** Required when severity differs from the category default (SPEC section 8). */
  severityReason: z.string().trim().max(EXPLANATION_MAX_CHARS).optional(),
  segmentId,
  quote: z.string().trim().min(1).max(EXPLANATION_MAX_CHARS),
  title,
  plain: explanation,
  why: explanation,
});

export const modelMissingSchema = z.object({
  id: z.string().regex(/^m[1-9]\d*$/),
  basicId: categoryId,
  title,
  plain: explanation,
  why: explanation,
});

export const modelClauseSchema = z.object({
  segmentId,
  heading: title,
  plain: explanation,
});

export const modelKeyFactSchema = z.object({
  label: title,
  value: title,
  segmentId: segmentId.optional(),
});

const refs = z.array(flagRef).default([]);

export const modelQuestionSchema = z.object({ text: explanation, refs });
export const modelChecklistItemSchema = z.object({ text: explanation, refs });
export const modelGlossarySchema = z.object({ term: title, definition: explanation });

/** The model's answer when the text is not a legal document (SPEC section 6 step 8). */
export const notLegalSchema = z.object({ notLegal: z.literal(true) });

const synthesisFields = {
  summary: explanation,
  keyFacts: z.array(modelKeyFactSchema).default([]),
  missing: z.array(modelMissingSchema).default([]),
  questions: z.array(modelQuestionSchema).default([]),
  checklist: z
    .object({
      before: z.array(modelChecklistItemSchema).default([]),
      after: z.array(modelChecklistItemSchema).default([]),
    })
    .default({ before: [], after: [] }),
  glossary: z.array(modelGlossarySchema).default([]),
};

/** Single-call path: everything in one answer. */
export const analysisOutputSchema = z.union([
  notLegalSchema,
  z.object({
    title,
    coverage: z.array(coverageSchema),
    flags: z.array(modelFlagSchema).default([]),
    clauses: z.array(modelClauseSchema).default([]),
    ...synthesisFields,
  }),
]);

/** Chunked path, one chunk: flags, clause readings, key-fact candidates and coverage. */
export const chunkOutputSchema = z.union([
  notLegalSchema,
  z.object({
    title: title.optional(),
    coverage: z.array(coverageSchema),
    flags: z.array(modelFlagSchema).default([]),
    clauses: z.array(modelClauseSchema).default([]),
    keyFacts: z.array(modelKeyFactSchema).default([]),
  }),
]);

/** Chunked path, final call: sees only flags, key-fact candidates and uncovered categories. */
export const synthesisOutputSchema = z.object(synthesisFields);

/** Step 5 fallback: the type of a document the keywords could not place. */
export const docTypeOutputSchema = z.object({
  docType: z.enum(DOC_TYPES),
  confidence: z.enum(CONFIDENCES),
  /** A short name for an "other" document, such as "Insurance policy". */
  label: title.optional(),
});

export type Coverage = z.infer<typeof coverageSchema>;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
export type ModelFlag = z.infer<typeof modelFlagSchema>;
export type ModelMissing = z.infer<typeof modelMissingSchema>;
export type ModelClause = z.infer<typeof modelClauseSchema>;
export type ModelKeyFact = z.infer<typeof modelKeyFactSchema>;
export type ModelQuestion = z.infer<typeof modelQuestionSchema>;
export type ModelChecklistItem = z.infer<typeof modelChecklistItemSchema>;
export type ModelGlossary = z.infer<typeof modelGlossarySchema>;
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type ChunkOutput = z.infer<typeof chunkOutputSchema>;
export type SynthesisOutput = z.infer<typeof synthesisOutputSchema>;
export type DocTypeOutput = z.infer<typeof docTypeOutputSchema>;

export function isNotLegal(output: AnalysisOutput | ChunkOutput): output is { notLegal: true } {
  return "notLegal" in output;
}
