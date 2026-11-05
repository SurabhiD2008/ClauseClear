// SPEC section 6 step 5: keyword scoring per type. Confident when the top score
// is at least TYPE_CONFIDENT_MIN_SCORE and at least TYPE_CONFIDENT_RATIO times
// the runner-up; otherwise one small model call on the first
// TYPE_DETECT_SAMPLE_TOKENS of the document. The user can override later.
import {
  CHARS_PER_TOKEN,
  DOC_TYPE_MAX_OUTPUT_TOKENS,
  TYPE_CONFIDENT_MIN_SCORE,
  TYPE_CONFIDENT_RATIO,
  TYPE_DETECT_SAMPLE_TOKENS,
  type Confidence,
  type DocType,
  type Segment,
} from "@clauseclear/shared";
import { checklistFor } from "../checklists/index.js";
import { LlmRouterError, zodOutput, type LlmRouter } from "../llm/index.js";
import { docTypeOutputSchema } from "./modelOutput.js";
import { buildDocTypePrompts } from "./prompts/index.js";

type KnownType = Exclude<DocType, "other">;

/**
 * Keywords per type with weights: 3 for a phrase that names the document, 2 for
 * a term mostly found in that type, 1 for a common supporting word. Each keyword
 * counts at most KEYWORD_CAP times, so one repeated word cannot decide alone.
 */
export const TYPE_KEYWORDS: Record<KnownType, [string, number][]> = {
  rental: [
    ["leave and license", 3],
    ["rent agreement", 3],
    ["rental agreement", 3],
    ["lease agreement", 3],
    ["licensor", 2],
    ["licensee", 2],
    ["tenant", 2],
    ["landlord", 2],
    ["tenancy", 2],
    ["lessee", 2],
    ["lessor", 2],
    ["security deposit", 2],
    ["lock-in", 2],
    ["license fee", 2],
    ["premises", 1],
    ["rent", 1],
    ["society", 1],
    ["flat", 1],
  ],
  employment: [
    ["offer of employment", 3],
    ["employment agreement", 3],
    ["appointment letter", 3],
    ["employment", 2],
    ["employee", 2],
    ["employer", 2],
    ["salary", 2],
    ["probation", 2],
    ["provident fund", 2],
    ["gratuity", 2],
    ["non-compete", 2],
    ["joining", 1],
    ["compensation", 1],
    ["bonus", 1],
    ["designation", 1],
    ["notice period", 1],
  ],
  loan: [
    ["loan agreement", 3],
    ["credit agreement", 3],
    ["borrower", 2],
    ["lender", 2],
    ["loan", 2],
    ["instalment", 2],
    ["installment", 2],
    ["emi", 2],
    ["guarantor", 2],
    ["foreclosure", 2],
    ["prepayment", 2],
    ["penal interest", 2],
    ["disbursed", 2],
    ["collateral", 2],
    ["mortgage", 2],
    ["interest", 1],
    ["principal", 1],
  ],
  terms: [
    ["terms of service", 3],
    ["terms of use", 3],
    ["user agreement", 3],
    ["privacy policy", 2],
    ["subscription", 2],
    ["your content", 2],
    ["user content", 2],
    ["class action", 2],
    ["cookies", 2],
    ["the service", 1],
    ["account", 1],
    ["app", 1],
    ["website", 1],
    ["users", 1],
  ],
};

export const KEYWORD_CAP = 3;

export type DetectionMethod = "override" | "keywords" | "model" | "fallback";

export interface TypeDetection {
  docType: DocType;
  docTypeLabel: string;
  confidence: Confidence;
  method: DetectionMethod;
  scores: Record<KnownType, number>;
}

function countPhrase(text: string, phrase: string): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return text.match(new RegExp(`\\b${escaped}\\b`, "gi"))?.length ?? 0;
}

export function keywordScores(text: string): Record<KnownType, number> {
  const scores = { rental: 0, employment: 0, loan: 0, terms: 0 };
  for (const type of Object.keys(TYPE_KEYWORDS) as KnownType[]) {
    for (const [phrase, weight] of TYPE_KEYWORDS[type]) {
      scores[type] += Math.min(countPhrase(text, phrase), KEYWORD_CAP) * weight;
    }
  }
  return scores;
}

/** The confident type, or undefined when the scores do not meet the SPEC rule. */
export function confidentType(scores: Record<KnownType, number>): KnownType | undefined {
  const ranked = (Object.entries(scores) as [KnownType, number][]).sort((a, b) => b[1] - a[1]);
  const [top, runnerUp] = ranked;
  if (top === undefined) return undefined;
  const second = runnerUp?.[1] ?? 0;
  return top[1] >= TYPE_CONFIDENT_MIN_SCORE && top[1] >= TYPE_CONFIDENT_RATIO * second
    ? top[0]
    : undefined;
}

/** The first TYPE_DETECT_SAMPLE_TOKENS of the document, cut at a segment boundary when possible. */
export function detectionSample(segments: Segment[]): Segment[] {
  const budget = TYPE_DETECT_SAMPLE_TOKENS * CHARS_PER_TOKEN;
  const sample: Segment[] = [];
  let used = 0;
  for (const segment of segments) {
    if (used + segment.text.length > budget) {
      if (sample.length === 0) sample.push({ ...segment, text: segment.text.slice(0, budget) });
      break;
    }
    sample.push(segment);
    used += segment.text.length;
  }
  return sample;
}

function labelFor(docType: DocType, modelLabel?: string): string {
  return docType === "other" && modelLabel !== undefined ? modelLabel : checklistFor(docType).label;
}

export interface DetectOptions {
  router: LlmRouter;
  /** A type chosen by the user skips detection. */
  override?: DocType;
  signal?: AbortSignal;
  deadline?: number;
}

export async function detectType(
  segments: Segment[],
  options: DetectOptions,
): Promise<TypeDetection> {
  const text = segments.map((s) => s.text).join("\n\n");
  const scores = keywordScores(text);

  if (options.override !== undefined) {
    return {
      docType: options.override,
      docTypeLabel: labelFor(options.override),
      confidence: "high",
      method: "override",
      scores,
    };
  }

  const confident = confidentType(scores);
  if (confident !== undefined) {
    return {
      docType: confident,
      docTypeLabel: labelFor(confident),
      confidence: "high",
      method: "keywords",
      scores,
    };
  }

  try {
    const { value } = await options.router.generate(
      {
        ...buildDocTypePrompts(detectionSample(segments)),
        schemaName: "docType",
        maxOutputTokens: DOC_TYPE_MAX_OUTPUT_TOKENS,
      },
      zodOutput(docTypeOutputSchema),
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
      },
    );
    return {
      docType: value.docType,
      docTypeLabel: labelFor(value.docType, value.label),
      confidence: value.confidence,
      method: "model",
      scores,
    };
  } catch (error) {
    // The detection call is a convenience: if no provider can answer it, keep
    // the keyword leader at low confidence and let the analysis call decide
    // whether providers are really down (ASSUMPTIONS A75).
    if (!(error instanceof LlmRouterError)) throw error;
    const ranked = (Object.entries(scores) as [KnownType, number][]).sort((a, b) => b[1] - a[1]);
    const leader = ranked[0];
    const docType: DocType = leader !== undefined && leader[1] > 0 ? leader[0] : "other";
    return {
      docType,
      docTypeLabel: labelFor(docType),
      confidence: "low",
      method: "fallback",
      scores,
    };
  }
}
