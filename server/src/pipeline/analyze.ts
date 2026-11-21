// The analysis orchestrator. Detects the type,
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
} from "@clauseclear/shared";
import { LlmRouterError, zodOutput } from "../llm/index.js";
import {
  startContext,
  type AnalyzeOptions,
  type AnalyzeOutcome,
  type ChunkSizes,
  type Context,
} from "./analyzeContext.js";
import { chunkSegments, fitsInOneCall } from "./chunk.js";
import { PipelineError } from "./errors.js";
import { assembleDraft, mergeChunks, type ChunkFindings } from "./merge.js";
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
import { runPool } from "./pool.js";

export type { AnalyzeOptions, AnalyzeOutcome } from "./analyzeContext.js";

/** Tokens of a prompt pair as the router estimates them. */
function promptTokens(prompts: PromptPair): number {
  return estimateTokens(prompts.system) + estimateTokens(prompts.user);
}

/** Single path when the whole prompt fits. */
async function singlePass(ctx: Context): Promise<AnalyzeOutcome> {
  const { router, segments, signal } = ctx.options;
  ctx.progress({ step: "analyzing", detail: "reading the whole document" });
  const { value } = await router.generate(
    {
      ...buildAnalysisPrompts({ ...ctx.base, segments }),
      schemaName: "analysis",
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
    },
    zodOutput(analysisOutputSchema),
    ctx.callOptions(signal),
  );
  if (isNotLegal(value)) throw new PipelineError("NOT_LEGAL");
  const { coverage, flags, clauses, keyFacts } = value;
  const merged = mergeChunks([{ part: 0, coverage, flags, clauses, keyFacts }], ctx.checklist);
  return {
    detection: ctx.detection,
    draft: assembleDraft({
      ...ctx.common,
      title: value.title,
      merged,
      synthesis: value,
      flagRefs: "model",
      path: "single",
      calls: 1,
    }),
  };
}

/** Reads every part, CHUNK_CONCURRENCY at a time, reporting each one as it finishes. */
async function readParts(ctx: Context, sizes: ChunkSizes) {
  const { router, segments, signal } = ctx.options;
  const chunkOverhead = promptTokens(
    buildChunkPrompts({ ...ctx.base, segments: [], part: 0, parts: 2 }),
  );
  const target = Math.max(
    1,
    Math.min(sizes.targetTokens, ctx.options.maxInputTokens - chunkOverhead),
  );
  const chunks = chunkSegments(segments, target);
  let done = 0;
  ctx.progress({
    step: "analyzing",
    detail: `reading the document in ${String(chunks.length)} parts`,
  });
  const answers = await runPool(chunks, CHUNK_CONCURRENCY, signal, async (chunk, laneSignal) => {
    const { value } = await router.generate(
      {
        ...buildChunkPrompts({
          ...ctx.base,
          segments: chunk.segments,
          part: chunk.index,
          parts: chunks.length,
        }),
        schemaName: "chunk",
        maxOutputTokens: sizes.chunkMaxOutput,
      },
      zodOutput(chunkOutputSchema),
      ctx.callOptions(laneSignal),
    );
    done += 1;
    ctx.progress({
      step: "analyzing",
      detail: `read part ${String(done)} of ${String(chunks.length)}`,
    });
    return { part: chunk.index, value };
  });
  return { answers, parts: chunks.length };
}

/** The legal parts' findings and the first title; NOT_LEGAL only when every part says so. */
function legalFindings(answers: Awaited<ReturnType<typeof readParts>>["answers"]) {
  // A cover page alone saying "not legal" is not enough.
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
  return { findings, title };
}

/** The final call: it sees only the merged flags, key-fact candidates and uncovered categories. */
async function synthesise(
  ctx: Context,
  merged: ReturnType<typeof mergeChunks>,
  maxOutputTokens: number,
) {
  const { checklist } = ctx;
  ctx.progress({ step: "analyzing", detail: "writing the summary" });
  const uncovered = new Set(merged.uncovered);
  const prompts = buildSynthesisPrompts({
    checklist,
    docTypeLabel: ctx.detection.docTypeLabel,
    flags: merged.flags.map(({ flag }, i) => ({
      id: `f${String(i + 1)}`,
      category: checklist.categories.find((c) => c.id === flag.categoryId)?.name ?? flag.categoryId,
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
  const { value } = await ctx.options.router.generate(
    { ...prompts, schemaName: "synthesis", maxOutputTokens },
    zodOutput(synthesisOutputSchema),
    ctx.callOptions(ctx.options.signal),
  );
  return value;
}

/** Chunked path: parts at segment boundaries, two at a time, then synthesis. */
async function chunkedPass(ctx: Context, sizes: ChunkSizes): Promise<AnalyzeOutcome> {
  const { answers, parts } = await readParts(ctx, sizes);
  const { findings, title } = legalFindings(answers);
  const merged = mergeChunks(findings, ctx.checklist);
  const synthesis = await synthesise(ctx, merged, sizes.synthesisMaxOutput);
  return {
    detection: ctx.detection,
    draft: assembleDraft({
      ...ctx.common,
      title: title ?? ctx.checklist.label,
      merged,
      synthesis,
      flagRefs: "final",
      path: sizes.path,
      calls: parts + 1,
    }),
  };
}

export async function analyzeDocument(options: AnalyzeOptions): Promise<AnalyzeOutcome> {
  const { router, segments, signal } = options;
  const ctx = await startContext(options);
  const overhead = promptTokens(buildAnalysisPrompts({ ...ctx.base, segments: [] }));
  const normal: ChunkSizes = {
    targetTokens: options.chunkTargetTokens ?? CHUNK_TARGET_TOKENS,
    chunkMaxOutput: CHUNK_MAX_OUTPUT_TOKENS,
    synthesisMaxOutput: SYNTHESIS_MAX_OUTPUT_TOKENS,
    path: "chunked",
  };
  try {
    return fitsInOneCall(segments, options.maxInputTokens, overhead)
      ? await singlePass(ctx)
      : await chunkedPass(ctx, normal);
  } catch (error) {
    // When the calls were too big for a capped provider (for example
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
    ctx.progress({ step: "analyzing", detail: "reading again in smaller parts" });
    return chunkedPass(ctx, {
      targetTokens: Math.max(1, Math.floor(cap / CAPPED_OUTPUT_PER_INPUT_TOKEN)),
      chunkMaxOutput: cap,
      synthesisMaxOutput: Math.min(SYNTHESIS_MAX_OUTPUT_TOKENS, cap),
      path: "small-chunks",
    });
  }
}
