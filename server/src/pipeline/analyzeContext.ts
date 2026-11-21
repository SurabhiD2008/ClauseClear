// The options of one analysis and the context its calls share: the detected
// type, its checklist, and how progress and call limits are passed on.
import type { Checklist, DocType, Segment, StatusEvent } from "@clauseclear/shared";
import { checklistFor } from "../checklists/index.js";
import type { LlmRouter } from "../llm/index.js";
import { detectType, type TypeDetection } from "./detectType.js";
import type { DraftAnalysis } from "./merge.js";

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
  /** A stricter retry after failed verification. */
  strict?: boolean;
  signal?: AbortSignal;
  /** Absolute router-clock time the whole analysis must finish by. */
  deadline?: number;
  onProgress?: (event: StatusEvent) => void;
}

export interface ChunkSizes {
  targetTokens: number;
  chunkMaxOutput: number;
  synthesisMaxOutput: number;
  path: "chunked" | "small-chunks";
}

export interface AnalyzeOutcome {
  draft: DraftAnalysis;
  detection: TypeDetection;
}

/** Everything one analysis shares across its calls. */
export interface Context {
  options: AnalyzeOptions;
  progress: (event: StatusEvent) => void;
  callOptions: (s: AbortSignal | undefined) => { signal?: AbortSignal; deadline?: number };
  detection: TypeDetection;
  checklist: Checklist;
  base: { checklist: Checklist; docTypeLabel: string; pages: number; strict?: boolean };
  common: {
    checklist: Checklist;
    docType: DocType;
    docTypeLabel: string;
    docTypeConfidence: TypeDetection["confidence"];
  };
}

export async function startContext(options: AnalyzeOptions): Promise<Context> {
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
  return {
    options,
    progress,
    callOptions,
    detection,
    checklist,
    base: {
      checklist,
      docTypeLabel: detection.docTypeLabel,
      pages: options.pages,
      ...(options.strict === undefined ? {} : { strict: options.strict }),
    },
    common: {
      checklist,
      docType: detection.docType,
      docTypeLabel: detection.docTypeLabel,
      docTypeConfidence: detection.confidence,
    },
  };
}
