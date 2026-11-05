// The analysis orchestrator (SPEC section 6 steps 5 to 7). Detects the type,
// then either makes one call (the segments fit MAX_INPUT_TOKENS with the prompt
// overhead) or reads the document in chunks, CHUNK_CONCURRENCY at a time, and
// finishes with a synthesis call that sees only the merged flags, key-fact
// candidates and uncovered categories. Every call goes through the router.
// Progress is reported through onProgress, which the SSE route will forward.
import {
  ANALYSIS_MAX_OUTPUT_TOKENS,
  CAPPED_OUTPUT_PER_INPUT_TOKEN,
  CHUNK_CONCURRENCY,
  CHUNK_MAX_OUTPUT_TOKENS,
  CHUNK_TARGET_TOKENS,
  SYNTHESIS_MAX_OUTPUT_TOKENS,
  estimateTokens,
  type DocType,
  type Segment,
  type StatusEvent,
} from "@clauseclear/shared";
import { checklistFor } from "../checklists/index.js";
import { LlmRouterError, zodOutput, type LlmRouter } from "../llm/index.js";
import { chunkSegments, fitsInOneCall } from "./chunk.js";
import { detectType, type TypeDetection } from "./detectType.js";
import { PipelineError } from "./errors.js";
import { assembleDraft, mergeChunks, type ChunkFindings, type DraftAnalysis } from "./merge.js";
import {
  analysisOutputSchema,
  chunkOutputSchema,
  isNotLegal,
  synthesisOutputSchema,
} from "./modelOutput.js";
import {
  buildAnalysisPrompts,
  buildChunkPrompts,
  buildSynthesisPrompts,
  type PromptPair,
} from "./prompts/index.js";

export interface AnalyzeOptions {
  router: LlmRouter;
  segments: Segment[];
  pages: number;
  /** MAX_INPUT_TOKENS from the router config. */
  maxInputTokens: number;
  /** Defaults to CHUNK_TARGET_TOKENS (lowered when MAX_INPUT_TOKENS is smaller). */
  chunkTargetTokens?: number;
  /** A type chosen by the user skips detection. */
  docType?: DocType;
  /** A stricter retry after failed verification (SPEC section 6 step 8). */
  strict?: boolean;
  signal?: AbortSignal;
  /** Absolute router-clock time the whole analysis must finish by. */
  deadline?: number;
  onProgress?: (event: StatusEvent) => void;
}

interface ChunkSizes {
  targetTokens: number;
  chunkMaxOutput: number;
  synthesisMaxOutput: number;
  path: "chunked" | "small-chunks";
}

export interface AnalyzeOutcome {
  draft: DraftAnalysis;
  detection: TypeDetection;
}

/** Tokens of a prompt pair as the router estimates them. */
function promptTokens(prompts: PromptPair): number {
  return estimateTokens(prompts.system) + estimateTokens(prompts.user);
}

/**
 * Runs work over items, at most `limit` at a time, in order of start. The
 * first failure aborts the rest and is the one rethrown.
 */
async function runPool<T, R>(
  items: T[],
  limit: number,
  signal: AbortSignal | undefined,
  work: (item: T, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(signal?.reason);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  /** Every lane failure, in order; the first is the one rethrown. */
  const failures: unknown[] = [];
  const lane = async () => {
    while (next < items.length && failures.length === 0) {
      const index = next;
      next += 1;
      try {
        results[index] = await work(items[index] as T, controller.signal);
      } catch (error) {
        // Only the first abort takes effect; later ones are no-ops.
        controller.abort(error);
        failures.push(error);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (failures.length > 0) throw signal?.aborted === true ? signal.reason : failures[0];
  return results;
}

export async function analyzeDocument(options: AnalyzeOptions): Promise<AnalyzeOutcome> {
  const { router, segments, signal } = options;
  const progress = options.onProgress ?? (() => undefined);
  const callOptions = (s: AbortSignal | undefined) => ({
    ...(s === undefined ? {} : { signal: s }),
    ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
  });

  signal?.throwIfAborted();
  progress({ step: "detecting" });
  const detection = await detectType(segments, {
    router,
    ...(options.docType === undefined ? {} : { override: options.docType }),
    ...callOptions(signal),
  });
  const checklist = checklistFor(detection.docType);
  const base = {
    checklist,
    docTypeLabel: detection.docTypeLabel,
    pages: options.pages,
    ...(options.strict === undefined ? {} : { strict: options.strict }),
  };
  const common = {
    checklist,
    docType: detection.docType,
    docTypeLabel: detection.docTypeLabel,
    docTypeConfidence: detection.confidence,
  };

  // Single path when the whole prompt fits (SPEC section 6 step 7).
  const overhead = promptTokens(buildAnalysisPrompts({ ...base, segments: [] }));
  const single = async (): Promise<AnalyzeOutcome> => {
    progress({ step: "analyzing", detail: "reading the whole document" });
    const { value } = await router.generate(
      {
        ...buildAnalysisPrompts({ ...base, segments }),
        schemaName: "analysis",
        maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      },
      zodOutput(analysisOutputSchema),
      callOptions(signal),
    );
    if (isNotLegal(value)) throw new PipelineError("NOT_LEGAL");
    const merged = mergeChunks(
      [
        {
          part: 0,
          coverage: value.coverage,
          flags: value.flags,
          clauses: value.clauses,
          keyFacts: value.keyFacts,
        },
      ],
      checklist,
    );
    return {
      detection,
      draft: assembleDraft({
        ...common,
        title: value.title,
        merged,
        synthesis: value,
        flagRefs: "model",
        path: "single",
        calls: 1,
      }),
    };
  };

  // Chunked path: parts at segment boundaries, two at a time, then synthesis.
  const chunkOverhead = promptTokens(
    buildChunkPrompts({ ...base, segments: [], part: 0, parts: 2 }),
  );
  const chunked = async (sizes: ChunkSizes): Promise<AnalyzeOutcome> => {
    const target = Math.max(
      1,
      Math.min(sizes.targetTokens, options.maxInputTokens - chunkOverhead),
    );
    const chunks = chunkSegments(segments, target);
    let done = 0;
    progress({
      step: "analyzing",
      detail: `reading the document in ${String(chunks.length)} parts`,
    });
    const answers = await runPool(chunks, CHUNK_CONCURRENCY, signal, async (chunk, laneSignal) => {
      const { value } = await router.generate(
        {
          ...buildChunkPrompts({
            ...base,
            segments: chunk.segments,
            part: chunk.index,
            parts: chunks.length,
          }),
          schemaName: "chunk",
          maxOutputTokens: sizes.chunkMaxOutput,
        },
        zodOutput(chunkOutputSchema),
        callOptions(laneSignal),
      );
      done += 1;
      progress({
        step: "analyzing",
        detail: `read part ${String(done)} of ${String(chunks.length)}`,
      });
      return { part: chunk.index, value };
    });

    // NOT_LEGAL only when every part says so; a cover page alone is not enough (A77).
    const legal = answers.filter((a) => !isNotLegal(a.value));
    if (legal.length === 0) throw new PipelineError("NOT_LEGAL");
    const findings: ChunkFindings[] = [];
    let title: string | undefined;
    for (const { part, value } of legal) {
      if (isNotLegal(value)) continue;
      title ??= value.title;
      findings.push({
        part,
        coverage: value.coverage,
        flags: value.flags,
        clauses: value.clauses,
        keyFacts: value.keyFacts,
      });
    }
    const merged = mergeChunks(findings, checklist);

    progress({ step: "analyzing", detail: "writing the summary" });
    const draftIds = merged.flags.map((_, i) => `f${String(i + 1)}`);
    const uncovered = new Set(merged.uncovered);
    const synthesisPrompts = buildSynthesisPrompts({
      checklist,
      docTypeLabel: detection.docTypeLabel,
      flags: merged.flags.map(({ flag }, i) => ({
        id: draftIds[i] ?? "",
        category:
          checklist.categories.find((c) => c.id === flag.categoryId)?.name ?? flag.categoryId,
        severity: flag.severity,
        title: flag.title,
        plain: flag.plain,
        quote: flag.quote,
      })),
      keyFactCandidates: merged.keyFacts,
      uncovered: checklist.categories
        .filter((c) => uncovered.has(c.id))
        .map((c) => ({ categoryId: c.id, name: c.name })),
      missingBasics: checklist.missingBasics
        .filter((b) => uncovered.has(b.categoryId))
        .map((b) => ({ basicId: b.id, name: b.name })),
    });
    const { value: synthesis } = await router.generate(
      { ...synthesisPrompts, schemaName: "synthesis", maxOutputTokens: sizes.synthesisMaxOutput },
      zodOutput(synthesisOutputSchema),
      callOptions(signal),
    );

    return {
      detection,
      draft: assembleDraft({
        ...common,
        title: title ?? checklist.label,
        merged,
        synthesis,
        flagRefs: "final",
        path: sizes.path,
        calls: chunks.length + 1,
      }),
    };
  };

  const normal: ChunkSizes = {
    targetTokens: options.chunkTargetTokens ?? CHUNK_TARGET_TOKENS,
    chunkMaxOutput: CHUNK_MAX_OUTPUT_TOKENS,
    synthesisMaxOutput: SYNTHESIS_MAX_OUTPUT_TOKENS,
    path: "chunked",
  };
  try {
    return fitsInOneCall(segments, options.maxInputTokens, overhead)
      ? await single()
      : await chunked(normal);
  } catch (error) {
    // A95: when the calls were too big for a capped provider (for example
    // NVIDIA's free tier) and the others failed, read again in parts small
    // enough that every call fits the smallest cap.
    const cap = router.smallestOutputCap;
    if (
      !(error instanceof LlmRouterError) ||
      cap === undefined ||
      cap >= CHUNK_MAX_OUTPUT_TOKENS ||
      signal?.aborted === true
    ) {
      throw error;
    }
    progress({ step: "analyzing", detail: "reading again in smaller parts" });
    return chunked({
      targetTokens: Math.max(1, Math.floor(cap / CAPPED_OUTPUT_PER_INPUT_TOKEN)),
      chunkMaxOutput: cap,
      synthesisMaxOutput: Math.min(SYNTHESIS_MAX_OUTPUT_TOKENS, cap),
      path: "small-chunks",
    });
  }
}
