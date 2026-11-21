// The model evaluation set: cases in eval/cases.json, each with an input and an
// expected outcome. A case runs through the same intake checks and pipeline as
// POST /api/analyze. Outcomes decided in code (a refusal code, the type found by
// keywords, verified quotes) are checked on every run; outcomes the model
// decides (which categories it flags) are scored and reported, tuned and
// held-out cases apart, so prompt changes are judged on cases they never saw.
import { readFileSync } from "node:fs";
import {
  docTypeSchema,
  errorCodeSchema,
  type AnalysisResult,
  type ErrorCode,
} from "@clauseclear/shared";
import { z } from "zod";
import { LlmRouterError, type LlmRouter } from "../llm/index.js";
import { confidentType, keywordScores } from "../pipeline/detectType.js";
import { PipelineError } from "../pipeline/errors.js";
import { checkPdfBytes, readPastedText } from "../pipeline/extract.js";
import { runAnalysis, type AnalysisInput } from "../pipeline/run.js";

export const EVAL_CASES_URL = new URL("../../../eval/cases.json", import.meta.url);
export const EVAL_DOCS_URL = new URL("../../../fixtures/docs/", import.meta.url);

const caseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["typical", "edge", "adversarial"]),
  split: z.enum(["tune", "holdout"]),
  input: z.union([z.strictObject({ pdf: z.string() }), z.strictObject({ text: z.string() })]),
  expect: z.strictObject({
    refused: errorCodeSchema.optional(),
    docType: docTypeSchema.optional(),
    mustFlag: z.array(z.string()).optional(),
    minFlags: z.number().int().min(0).optional(),
    maxFlags: z.number().int().min(0).optional(),
    minScore: z.number().int().min(0).optional(),
  }),
});

export type EvalCase = z.infer<typeof caseSchema>;

export function loadCases(): EvalCase[] {
  const cases = z.array(caseSchema).parse(JSON.parse(readFileSync(EVAL_CASES_URL, "utf8")));
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error("eval case ids must be unique");
  return cases;
}

export interface CaseOutcome {
  id: string;
  kind: EvalCase["kind"];
  split: EvalCase["split"];
  /** Failures of outcomes decided in code; these must be empty on every run. */
  codeFailures: string[];
  /** Failures of outcomes the model decides; scored, not required of the mock. */
  modelFailures: string[];
  refused?: ErrorCode;
  docType?: string;
  flags?: number;
  score?: number;
}

function toInput(c: EvalCase): AnalysisInput {
  if ("pdf" in c.input) {
    const bytes = new Uint8Array(readFileSync(new URL(c.input.pdf, EVAL_DOCS_URL)));
    checkPdfBytes(bytes);
    return { kind: "pdf", bytes };
  }
  readPastedText(c.input.text);
  return { kind: "text", text: c.input.text };
}

/** Every present flag's quote must be inside the segment it cites. */
function quoteFailures(result: AnalysisResult): string[] {
  const segments = new Map(result.segments.map((s) => [s.id, s.text]));
  return result.flags
    .filter((f) => f.kind === "present")
    .filter(
      (f) =>
        f.segmentId === undefined ||
        f.quote === undefined ||
        !(segments.get(f.segmentId) ?? "").includes(f.quote),
    )
    .map((f) => `flag ${f.id} quote is not in ${f.segmentId ?? "its segment"}`);
}

function judge(c: EvalCase, result: AnalysisResult, outcome: CaseOutcome): void {
  const { expect } = c;
  if (expect.refused !== undefined)
    outcome.modelFailures.push(`expected ${expect.refused}, got a result`);
  if (expect.docType !== undefined && result.docType !== expect.docType) {
    // Keywords decide the type when they are confident; otherwise the model does.
    const byKeywords = confidentType(
      keywordScores(result.segments.map((seg) => seg.text).join("\n")),
    );
    const failures = byKeywords === undefined ? outcome.modelFailures : outcome.codeFailures;
    failures.push(`docType ${result.docType}, expected ${expect.docType}`);
  }
  outcome.codeFailures.push(...quoteFailures(result));
  const categories = new Set(result.flags.map((f) => f.category));
  for (const name of expect.mustFlag ?? [])
    if (!categories.has(name)) outcome.modelFailures.push(`no "${name}" flag`);
  if (expect.minFlags !== undefined && result.flags.length < expect.minFlags)
    outcome.modelFailures.push(
      `${String(result.flags.length)} flags, expected at least ${String(expect.minFlags)}`,
    );
  if (expect.maxFlags !== undefined && result.flags.length > expect.maxFlags)
    outcome.modelFailures.push(
      `${String(result.flags.length)} flags, expected at most ${String(expect.maxFlags)}`,
    );
  if (expect.minScore !== undefined && result.score.value < expect.minScore)
    outcome.modelFailures.push(
      `score ${String(result.score.value)}, expected at least ${String(expect.minScore)}`,
    );
}

/** NOT_LEGAL is the model's call; every other refusal is decided in code. */
const MODEL_DECIDED: readonly ErrorCode[] = ["NOT_LEGAL"];

export async function runCase(
  c: EvalCase,
  router: LlmRouter,
  maxInputTokens: number,
): Promise<CaseOutcome> {
  const outcome: CaseOutcome = {
    id: c.id,
    kind: c.kind,
    split: c.split,
    codeFailures: [],
    modelFailures: [],
  };
  try {
    const { result } = await runAnalysis(toInput(c), { router, maxInputTokens });
    outcome.docType = result.docType;
    outcome.flags = result.flags.length;
    outcome.score = result.score.value;
    judge(c, result, outcome);
  } catch (error) {
    // A provider failure (rate limit, outage, spent call budget) is the case's
    // outcome, recorded as a model-side failure, never a crash of the whole run.
    if (error instanceof LlmRouterError) {
      outcome.modelFailures.push(`providers failed: ${error.code}`);
      return outcome;
    }
    if (!(error instanceof PipelineError)) throw error;
    outcome.refused = error.code;
    const want = c.expect.refused;
    if (want !== error.code) {
      const message = `refused with ${error.code}, expected ${want ?? "a result"}`;
      const modelCall =
        MODEL_DECIDED.includes(error.code) || (want !== undefined && MODEL_DECIDED.includes(want));
      (modelCall ? outcome.modelFailures : outcome.codeFailures).push(message);
    }
  }
  return outcome;
}

export interface EvalSummary {
  split: EvalCase["split"];
  cases: number;
  passed: number;
}

export function summarise(outcomes: CaseOutcome[]): EvalSummary[] {
  return (["tune", "holdout"] as const).map((split) => {
    const mine = outcomes.filter((o) => o.split === split);
    const passed = mine.filter(
      (o) => o.codeFailures.length === 0 && o.modelFailures.length === 0,
    ).length;
    return { split, cases: mine.length, passed };
  });
}
