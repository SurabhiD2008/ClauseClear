import type { ErrorCode } from "@clauseclear/shared";

/**
 * A pipeline failure: a rejected document (SPEC section 6 step 1) or NOT_LEGAL
 * from the analysis (step 8). The code is a shared ErrorCode,
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
