// One analysis from intake to a checked AnalysisResult (SPEC section 6 steps 1
// to 9). The route only adapts this to SSE or JSON: every step, the retry rule
// and the score live here.
import {
  VERIFY_RETRY_FAIL_RATIO,
  analysisResultSchema,
  computeScore,
  type AnalysisResult,
  type DocType,
  type Segment,
  type StatusEvent,
  type Warning,
} from "@clauseclear/shared";
import type { LlmRouter } from "../llm/index.js";
import { analyzeDocument } from "./analyze.js";
import { PipelineError } from "./errors.js";
import { readPastedText, readPdf, type DocumentText } from "./extract.js";
import type { DraftAnalysis } from "./merge.js";
import { segmentDocument } from "./segment.js";
import { verifyDraft, type FlagOutcome, type VerificationStats } from "./verify.js";

export type AnalysisInput = { kind: "pdf"; bytes: Uint8Array } | { kind: "text"; text: string };

export interface RunOptions {
  router: LlmRouter;
  maxInputTokens: number;
  docType?: DocType;
  signal?: AbortSignal;
  deadline?: number;
  onProgress?: (event: StatusEvent) => void;
}

/** What a run did, for the log line: counts only, never text. */
export interface RunReport {
  pages: number;
  segments: number;
  chars: number;
  docType: DocType;
  path: DraftAnalysis["path"];
  calls: number;
  retried: boolean;
  verification: VerificationStats;
  /** Per-flag outcomes of each attempt (two when the retry ran). */
  attempts: { stats: VerificationStats; outcomes: FlagOutcome[] }[];
  score: number;
  warnings: Warning[];
}

export interface RunOutcome {
  result: AnalysisResult;
  report: RunReport;
}

/** Builds the public result from a verified draft. The score comes from computeScore only. */
export function buildResult(
  draft: DraftAnalysis,
  doc: Pick<DocumentText, "text" | "pageCount">,
  segments: Segment[],
  warnings: Warning[],
): AnalysisResult {
  const flags = draft.flags.map((f) => ({
    id: f.id,
    kind: f.kind,
    severity: f.severity,
    category: f.category,
    title: f.title,
    plain: f.plain,
    why: f.why,
    ...(f.segmentId === undefined ? {} : { segmentId: f.segmentId }),
    ...(f.quote === undefined ? {} : { quote: f.quote }),
    termIds: f.termIds,
  }));
  const candidate: AnalysisResult = {
    version: 1,
    docType: draft.docType,
    docTypeLabel: draft.docTypeLabel,
    docTypeConfidence: draft.docTypeConfidence,
    title: draft.title,
    stats: { pages: doc.pageCount, chars: doc.text.length, segments: segments.length },
    segments,
    summary: draft.summary,
    score: computeScore(flags),
    keyFacts: draft.keyFacts,
    flags,
    clauses: draft.clauses,
    questions: draft.questions,
    checklist: draft.checklist,
    glossary: draft.glossary,
    warnings,
  };
  const parsed = analysisResultSchema.safeParse(candidate);
  // The paths only, never the values: an issue can quote document text.
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new PipelineError("ANALYSIS_FAILED", `result failed the schema at ${where}`);
  }
  return parsed.data;
}

export async function runAnalysis(input: AnalysisInput, options: RunOptions): Promise<RunOutcome> {
  const { router, maxInputTokens, signal, deadline } = options;
  const progress = (event: StatusEvent) => {
    signal?.throwIfAborted();
    options.onProgress?.(event);
  };

  progress({ step: "reading" });
  const doc =
    input.kind === "pdf"
      ? await readPdf(input.bytes, signal === undefined ? {} : { signal })
      : readPastedText(input.text);

  progress({ step: "segmenting" });
  const segments = segmentDocument(doc.pages);

  const common = {
    router,
    segments,
    pages: doc.pageCount,
    maxInputTokens,
    onProgress: progress,
    ...(signal === undefined ? {} : { signal }),
    ...(deadline === undefined ? {} : { deadline }),
  };
  const first = await analyzeDocument({
    ...common,
    ...(options.docType === undefined ? {} : { docType: options.docType }),
  });

  progress({ step: "verifying" });
  let verified = verifyDraft(first.draft, segments);
  const attempts = [{ stats: verified.stats, outcomes: verified.outcomes }];
  let calls = first.draft.calls;
  let retried = false;
  const warnings: Warning[] = [];
  if (verified.failRatio > VERIFY_RETRY_FAIL_RATIO) {
    // Step 8: one stricter attempt, on the type already found.
    retried = true;
    progress({ step: "verifying", detail: "checking again with a stricter reading" });
    const second = await analyzeDocument({
      ...common,
      docType: first.detection.docType,
      strict: true,
    });
    calls += second.draft.calls;
    const keepType = {
      docType: first.draft.docType,
      docTypeLabel: first.draft.docTypeLabel,
      docTypeConfidence: first.draft.docTypeConfidence,
    };
    verified = verifyDraft({ ...second.draft, ...keepType }, segments);
    attempts.push({ stats: verified.stats, outcomes: verified.outcomes });
    progress({ step: "verifying" });
    if (verified.failRatio > VERIFY_RETRY_FAIL_RATIO) warnings.push("partial_verification");
  }
  if (verified.draft.docTypeConfidence === "low") warnings.push("low_confidence_type");

  progress({ step: "scoring" });
  const result = buildResult(verified.draft, doc, segments, warnings);
  return {
    result,
    report: {
      pages: doc.pageCount,
      segments: segments.length,
      chars: doc.text.length,
      docType: result.docType,
      path: verified.draft.path,
      calls,
      retried,
      verification: verified.stats,
      attempts,
      score: result.score.value,
      warnings,
    },
  };
}
