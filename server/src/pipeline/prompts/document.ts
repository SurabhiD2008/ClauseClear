// The document block every prompt carries (SPEC section 6 step 6). Segments are
// written as "[s12] text", one per line, between two marker lines. The marker
// carries a hash of the block itself, so a document cannot contain a marker
// that closes its own block early: writing one would change the hash.
import { createHash } from "node:crypto";
import type { Segment } from "@clauseclear/shared";
import { segmentPromptLine } from "../chunk.js";

export interface DocumentBlock {
  /** 8 hex characters of SHA-256 over the segment lines. */
  id: string;
  begin: string;
  end: string;
  /** The full block: begin marker, one line per segment, end marker. */
  text: string;
}

export function documentBlock(segments: Segment[]): DocumentBlock {
  const lines = segments.map(segmentPromptLine).join("\n");
  const id = createHash("sha256").update(lines).digest("hex").slice(0, 8);
  const begin = `=====BEGIN DOCUMENT ${id}=====`;
  const end = `=====END DOCUMENT ${id}=====`;
  return { id, begin, end, text: `${begin}\n${lines}\n${end}` };
}

/** The same idea for data that is not the document (flags, candidates) in the synthesis call. */
export function dataBlock(name: string, value: unknown): string {
  const json = JSON.stringify(value);
  const id = createHash("sha256").update(json).digest("hex").slice(0, 8);
  return `=====BEGIN ${name} ${id}=====\n${json}\n=====END ${name} ${id}=====`;
}
