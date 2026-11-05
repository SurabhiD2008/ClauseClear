// Maps any failure to the one ErrorCode enum (SPEC section 7) and sends it as
// an HTTP error. After an SSE stream has started, the analyze route sends the
// same body as an `error` event instead.
import { ERROR_DEFINITIONS, errorBody, type ErrorBody } from "@clauseclear/shared";
import type { Response } from "express";
import { LlmRouterError } from "../llm/index.js";
import { PipelineError } from "../pipeline/errors.js";

/** RATE_LIMITED always carries retryAfterSec; this is the wait when nothing better is known (A86). */
export const DEFAULT_RETRY_AFTER_SEC = 60;

export function toErrorBody(error: unknown, signal?: AbortSignal): ErrorBody {
  // A disconnect wins over whatever the aborted work threw on its way out.
  if (signal?.aborted === true) return errorBody("CANCELLED");
  if (error instanceof PipelineError) return errorBody(error.code);
  if (error instanceof LlmRouterError) {
    if (error.code !== "RATE_LIMITED") return errorBody(error.code);
    return errorBody("RATE_LIMITED", {
      retryAfterSec: error.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC,
    });
  }
  return errorBody("ANALYSIS_FAILED");
}

export function sendError(res: Response, body: ErrorBody): void {
  if (body.retryAfterSec !== undefined) res.set("Retry-After", String(body.retryAfterSec));
  res.status(ERROR_DEFINITIONS[body.code].status).json(body);
}

/** What a log line may say about a failure: its class, and its message only for our own errors. */
export function errorSummary(error: unknown): { error: string; detail?: string } {
  if (error instanceof PipelineError) return { error: error.name, detail: error.message };
  if (error instanceof LlmRouterError) return { error: error.name, detail: error.code };
  return { error: error instanceof Error ? error.name : typeof error };
}
