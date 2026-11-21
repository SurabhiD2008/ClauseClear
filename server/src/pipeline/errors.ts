import type { ErrorCode } from "@clauseclear/shared";

/**
 * A pipeline failure: a rejected document or NOT_LEGAL
 * from the analysis. The code is a shared ErrorCode,
 * so the route can answer with ERROR_DEFINITIONS[code]. The message never
 * contains document text.
 */
export class PipelineError extends Error {
  override readonly name = "PipelineError";

  constructor(
    readonly code: ErrorCode,
    detail?: string,
  ) {
    super(detail === undefined ? code : `${code}: ${detail}`);
  }
}
