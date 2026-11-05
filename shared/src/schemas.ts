// Data contracts from SPEC section 7, written once and imported by the server,
// the client, the fixtures and the tests. Nothing redefines them.
import { z } from "zod";
import {
  EXPLANATION_MAX_CHARS,
  MAX_GLOSSARY_TERMS,
  MAX_KEY_FACTS,
  MAX_QUESTIONS,
  SCORE_MAX,
  TITLE_MAX_CHARS,
} from "./constants.js";
import { ERROR_CODES } from "./errors.js";
import { computeScore } from "./scoring.js";

// --- Enums ---
export const DOC_TYPES = ["rental", "employment", "loan", "terms", "other"] as const;
export const SEVERITIES = ["high", "medium"] as const;
export const FLAG_KINDS = ["present", "missing"] as const;
export const SCORE_BANDS = ["low", "medium", "high"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
export const WARNINGS = ["partial_verification", "truncated", "low_confidence_type"] as const;
export const PIPELINE_STEPS = [
  "reading",
  "segmenting",
  "detecting",
  "analyzing",
  "verifying",
  "scoring",
] as const;

export const docTypeSchema = z.enum(DOC_TYPES);
export const severitySchema = z.enum(SEVERITIES);
export const flagKindSchema = z.enum(FLAG_KINDS);
export const scoreBandSchema = z.enum(SCORE_BANDS);
export const confidenceSchema = z.enum(CONFIDENCES);
export const warningSchema = z.enum(WARNINGS);
export const pipelineStepSchema = z.enum(PIPELINE_STEPS);
export const errorCodeSchema = z.enum(ERROR_CODES);

export type DocType = z.infer<typeof docTypeSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type FlagKind = z.infer<typeof flagKindSchema>;
export type ScoreBand = z.infer<typeof scoreBandSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type PipelineStep = z.infer<typeof pipelineStepSchema>;

// --- Building blocks ---
/** Segments are s1, s2, ... and flags are f1, f2, ... (SPEC section 6 step 4, section 7). */
const segmentIdSchema = z.string().regex(/^s[1-9]\d*$/);
const flagIdSchema = z.string().regex(/^f[1-9]\d*$/);
/** Other ids: a lowercase letter prefix and a number, e.g. k1, c3, q2, b1, a1, g4. */
const itemIdSchema = z.string().regex(/^[a-z]+[1-9]\d*$/);
const titleText = z.string().min(1).max(TITLE_MAX_CHARS);
const explanationText = z.string().min(1).max(EXPLANATION_MAX_CHARS);
const count = z.int().min(0);

export const segmentSchema = z.strictObject({
  id: segmentIdSchema,
  page: z.int().min(1),
  text: z.string().min(1),
});

export const keyFactSchema = z.strictObject({
  id: itemIdSchema,
  label: titleText,
  value: titleText,
  segmentId: segmentIdSchema.optional(),
});

export const flagSchema = z.strictObject({
  id: flagIdSchema,
  kind: flagKindSchema,
  severity: severitySchema,
  category: titleText,
  title: titleText,
  plain: explanationText,
  why: explanationText,
  segmentId: segmentIdSchema.optional(),
  quote: z.string().min(1).optional(),
  termIds: z.array(itemIdSchema),
});

export const clauseSchema = z.strictObject({
  id: itemIdSchema,
  segmentId: segmentIdSchema,
  heading: titleText,
  plain: explanationText,
  flagId: flagIdSchema.optional(),
});

export const questionSchema = z.strictObject({
  id: itemIdSchema,
  text: explanationText,
  flagIds: z.array(flagIdSchema),
});

export const checklistItemSchema = z.strictObject({
  id: itemIdSchema,
  text: explanationText,
  flagIds: z.array(flagIdSchema),
});

export const glossaryEntrySchema = z.strictObject({
  id: itemIdSchema,
  term: titleText,
  definition: explanationText,
});

export const scoreSchema = z.strictObject({
  value: z.int().min(0).max(SCORE_MAX),
  band: scoreBandSchema,
  counts: z.strictObject({ high: count, medium: count, missing: count }),
});

const analysisResultShape = z.strictObject({
  version: z.literal(1),
  docType: docTypeSchema,
  docTypeLabel: titleText,
  docTypeConfidence: confidenceSchema,
  title: titleText,
  stats: z.strictObject({ pages: z.int().min(1), chars: count, segments: count }),
  segments: z.array(segmentSchema),
  summary: explanationText,
  score: scoreSchema,
  keyFacts: z.array(keyFactSchema).max(MAX_KEY_FACTS),
  flags: z.array(flagSchema),
  clauses: z.array(clauseSchema),
  questions: z.array(questionSchema).max(MAX_QUESTIONS),
  checklist: z.strictObject({
    before: z.array(checklistItemSchema),
    after: z.array(checklistItemSchema),
  }),
  glossary: z.array(glossaryEntrySchema).max(MAX_GLOSSARY_TERMS),
  warnings: z.array(warningSchema),
});

type ResultShape = z.infer<typeof analysisResultShape>;

/** Cross-field rules from SPEC section 7. */
function checkInvariants(r: ResultShape, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: (string | number)[]) => {
    ctx.addIssue({ code: "custom", message, path });
  };

  // Ids are unique across every collection, so a key like "flags.f1" or a
  // checklist tick keyed by item id can never point at two things.
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

  const segments = new Map(r.segments.map((s) => [s.id, s]));
  const flagIds = new Set(r.flags.map((f) => f.id));
  const termIds = new Set(r.glossary.map((g) => g.id));
  const checkSegment = (id: string | undefined, path: (string | number)[]) => {
    if (id !== undefined && !segments.has(id)) issue(`unknown segmentId "${id}"`, path);
  };
  const checkFlag = (id: string | undefined, path: (string | number)[]) => {
    if (id !== undefined && !flagIds.has(id)) issue(`unknown flagId "${id}"`, path);
  };

  if (r.stats.segments !== r.segments.length) {
    issue("stats.segments must equal the number of segments", ["stats", "segments"]);
  }

  r.keyFacts.forEach((k, i) => {
    checkSegment(k.segmentId, ["keyFacts", i, "segmentId"]);
  });

  r.flags.forEach((f, i) => {
    if (f.kind === "present") {
      if (f.segmentId === undefined || f.quote === undefined) {
        issue(`present flag ${f.id} needs segmentId and quote`, ["flags", i]);
      } else {
        checkSegment(f.segmentId, ["flags", i, "segmentId"]);
        // Verification (SPEC section 6 step 8) repairs every surviving quote to
        // the real text, so a valid result's quote is an exact substring.
        const segment = segments.get(f.segmentId);
        if (segment !== undefined && !segment.text.includes(f.quote)) {
          issue(`quote of ${f.id} not found in segment ${f.segmentId}`, ["flags", i, "quote"]);
        }
      }
    } else if (f.segmentId !== undefined || f.quote !== undefined) {
      issue(`missing flag ${f.id} must not have segmentId or quote`, ["flags", i]);
    }
    f.termIds.forEach((t, j) => {
      if (!termIds.has(t)) issue(`unknown termId "${t}"`, ["flags", i, "termIds", j]);
    });
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

export const analysisResultSchema = analysisResultShape.superRefine(checkInvariants);

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type KeyFact = z.infer<typeof keyFactSchema>;
export type Flag = z.infer<typeof flagSchema>;
export type Clause = z.infer<typeof clauseSchema>;
export type Question = z.infer<typeof questionSchema>;
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

// --- Translation (SPEC section 6 step 11, ASSUMPTIONS A18) ---
/** Dotted path into AnalysisResult (e.g. "flags.f1.plain") to text. */
export const translationMapSchema = z.record(z.string(), z.string());
export type TranslationMap = z.infer<typeof translationMapSchema>;

// --- Server-sent events from POST /api/analyze ---
export const SSE_EVENTS = { status: "status", result: "result", error: "error" } as const;

export const statusEventSchema = z.strictObject({
  step: pipelineStepSchema,
  detail: z.string().max(TITLE_MAX_CHARS).optional(),
});
export const resultEventSchema = analysisResultSchema;
export const errorEventSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().min(1),
  retryAfterSec: z.int().min(0).optional(),
});

export type StatusEvent = z.infer<typeof statusEventSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;

// --- Endpoint bodies (SPEC section 7) ---
export const healthResponseSchema = z.strictObject({ ok: z.literal(true) });

/** JSON body for POST /api/analyze. Length limits are checked by the server so each maps to its own error code. */
export const analyzeTextRequestSchema = z.strictObject({
  text: z.string(),
  docType: docTypeSchema.optional(),
});

export const translateRequestSchema = z.strictObject({
  lang: z.literal("hi"),
  strings: translationMapSchema,
});
export const translateResponseSchema = z.strictObject({
  strings: translationMapSchema,
  unchanged: z.array(z.string()),
});

export const sampleSummarySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: titleText,
  docType: docTypeSchema,
});
export const samplesListResponseSchema = z.array(sampleSummarySchema);
export const sampleResponseSchema = z.strictObject({
  en: analysisResultSchema,
  hi: translationMapSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type AnalyzeTextRequest = z.infer<typeof analyzeTextRequestSchema>;
export type TranslateRequest = z.infer<typeof translateRequestSchema>;
export type TranslateResponse = z.infer<typeof translateResponseSchema>;
export type SampleSummary = z.infer<typeof sampleSummarySchema>;
export type SampleResponse = z.infer<typeof sampleResponseSchema>;
