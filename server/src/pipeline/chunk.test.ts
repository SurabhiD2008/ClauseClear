import { estimateTokens, type Segment } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import {
  chunkSegments,
  documentTokens,
  fitsInOneCall,
  segmentPromptLine,
  segmentTokens,
} from "./chunk.js";

const segment = (n: number, chars: number): Segment => ({
  id: `s${String(n)}`,
  page: 1,
  text: "x".repeat(chars),
});

describe("token estimates", () => {
  it("estimates characters divided by 4, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("counts a segment as the prompt line the model sees", () => {
    const s = segment(12, 30);
    expect(segmentPromptLine(s)).toBe(`[s12] ${"x".repeat(30)}`);
    expect(segmentTokens(s)).toBe(Math.ceil((6 + 30) / 4));
  });

  it("counts a document as its prompt lines joined by newlines", () => {
    const segments = [segment(1, 10), segment(2, 10)];
    // Two lines of "[s1] " plus 10 characters, joined by one newline: 31 characters.
    expect(documentTokens(segments)).toBe(Math.ceil(31 / 4));
  });

  it("fits one call only when segments plus overhead are within the limit", () => {
    const segments = [segment(1, 395)]; // "[s1] " + 395 = 400 chars = 100 tokens
    expect(fitsInOneCall(segments, 150, 50)).toBe(true);
    expect(fitsInOneCall(segments, 149, 50)).toBe(false);
  });
});

describe("chunkSegments", () => {
  it("keeps everything in one chunk when it fits", () => {
    const segments = [segment(1, 100), segment(2, 100)];
    const chunks = chunkSegments(segments, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.tokens).toBe(documentTokens(segments));
  });

  it("cuts only at segment boundaries, in order, within the target", () => {
    const segments = Array.from({ length: 40 }, (_, n) => segment(n + 1, 300 + ((n * 37) % 500)));
    const target = 600;
    const chunks = chunkSegments(segments, target);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.segments)).toEqual(segments);
    chunks.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
      expect(chunk.tokens).toBeLessThanOrEqual(target);
      // The recorded size is exactly the size of the chunk's prompt block.
      expect(chunk.tokens).toBe(documentTokens(chunk.segments));
    });
  });

  it("gives a segment larger than the target a chunk of its own", () => {
    const chunks = chunkSegments([segment(1, 40), segment(2, 4000), segment(3, 40)], 100);
    expect(chunks.map((c) => c.segments.map((s) => s.id))).toEqual([["s1"], ["s2"], ["s3"]]);
  });

  it("returns no chunks for no segments", () => {
    expect(chunkSegments([])).toEqual([]);
  });
});
