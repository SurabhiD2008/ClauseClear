// SPEC section 6 step 7 (the split itself): chunks are cut at segment
// boundaries so no clause is ever divided between two model calls. Sizes are
// estimated from the text the model will see ("[s12] text"), at characters / 4.
import {
  CHARS_PER_TOKEN,
  CHUNK_TARGET_TOKENS,
  estimateTokens,
  type Segment,
} from "@clauseclear/shared";

export interface Chunk {
  /** 0-based position in the document. */
  index: number;
  segments: Segment[];
  tokens: number;
}

/**
 * A segment as it appears in the prompt (section 6 step 6): one line, so line
 * breaks inside a segment become spaces. Quote checks normalise whitespace, so
 * a quote copied from this line still matches the segment (ASSUMPTIONS A76).
 */
export function segmentPromptLine(segment: Segment): string {
  return `[${segment.id}] ${segment.text.replace(/\s+/g, " ")}`;
}

export function segmentTokens(segment: Segment): number {
  return estimateTokens(segmentPromptLine(segment));
}

/** Estimated tokens of all segments as one prompt block (one line each). */
export function documentTokens(segments: Segment[]): number {
  return estimateTokens(segments.map(segmentPromptLine).join("\n"));
}

/** True when the segments plus the prompt overhead fit one call (section 6 step 7). */
export function fitsInOneCall(
  segments: Segment[],
  maxInputTokens: number,
  overheadTokens: number,
): boolean {
  return documentTokens(segments) + overheadTokens <= maxInputTokens;
}

/**
 * Greedy chunking in document order: a segment joins the current chunk while
 * the total stays within targetTokens. A segment larger than the target (not
 * possible at 900 characters, but kept safe) becomes a chunk of its own.
 */
export function chunkSegments(segments: Segment[], targetTokens = CHUNK_TARGET_TOKENS): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Segment[] = [];
  // Characters of the chunk's prompt block, so tokens match documentTokens exactly.
  let chars = 0;
  const close = () => {
    chunks.push({
      index: chunks.length,
      segments: current,
      tokens: Math.ceil(chars / CHARS_PER_TOKEN),
    });
  };
  for (const segment of segments) {
    const line = segmentPromptLine(segment).length;
    // +1 for the newline joining it to the previous line.
    const next = current.length > 0 ? chars + 1 + line : line;
    if (current.length > 0 && Math.ceil(next / CHARS_PER_TOKEN) > targetTokens) {
      close();
      current = [segment];
      chars = line;
      continue;
    }
    current.push(segment);
    chars = next;
  }
  if (current.length > 0) close();
  return chunks;
}
