// POST /api/analyze (SPEC sections 6, 7 and 11).
//   - Body: multipart `file` (and an optional `docType` field) or JSON
//     `{ text, docType? }`. Anything else is BAD_REQUEST.
//   - Limits: per IP (express-rate-limit) and a global daily cap, both
//     RATE_LIMITED with retryAfterSec, answered before any stream starts.
//   - Response: server-sent events by default, plain JSON with ?stream=0.
//     Errors found before the stream starts use the HTTP status; after that
//     they are an `error` event (SPEC section 7).
//   - A client disconnect aborts the run: no further provider calls start.
// Logs carry counts, durations and codes, never text (SPEC section 11).
import { performance } from "node:perf_hooks";
import {
  IP_WINDOW_MS,
  MAX_FILE_BYTES,
  SSE_EVENTS,
  analyzeTextRequestSchema,
  docTypeSchema,
  errorBody,
  type DocType,
  type ErrorBody,
} from "@clauseclear/shared";
import express, { type Request, type RequestHandler, type Response } from "express";
import { rateLimit, type RateLimitInfo } from "express-rate-limit";
import multer from "multer";
import type { LimitsConfig } from "../config.js";
import {
  MOCK_SCENARIO_HEADER,
  runWithMockScenario,
  scenarioFromHeader,
  type LlmRouter,
} from "../llm/index.js";
import { DailyCounter, systemClock, type Clock } from "../llm/limiter.js";
import type { Logger } from "../logger.js";
import { PipelineError } from "../pipeline/errors.js";
import { checkPdfBytes, readPastedText } from "../pipeline/extract.js";
import { runAnalysis, type AnalysisInput } from "../pipeline/run.js";
import { errorSummary, sendError, toErrorBody } from "./errors.js";

/**
 * Largest JSON body read. 60,000 characters of text, even fully escaped, fit;
 * a bigger body is TEXT_TOO_LONG without being parsed (A84).
 */
export const JSON_BODY_LIMIT = "512kb";
/** An SSE comment this often keeps proxies from closing a quiet stream. */
export const SSE_HEARTBEAT_MS = 15_000;

export interface AnalyzeDeps {
  router: LlmRouter;
  maxInputTokens: number;
  budgetMs: number;
  limits: LimitsConfig;
  logger: Logger;
  /** NODE_ENV; the mock-scenario header is honoured only under "test". */
  nodeEnv: string | undefined;
  clock?: Clock;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 1, fieldSize: 64, parts: 2 },
}).single("file");
const json = express.json({ limit: JSON_BODY_LIMIT, strict: true });

/** Runs one Express middleware as a promise. */
function apply(handler: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    void handler(req, res, (error?: unknown) => {
      if (error === undefined) resolve();
      else
        reject(error instanceof Error ? error : new Error("middleware failed", { cause: error }));
    });
  });
}

function parseDocType(value: unknown): DocType | undefined {
  if (value === undefined) return undefined;
  const parsed = docTypeSchema.safeParse(value);
  if (!parsed.success) throw new PipelineError("BAD_REQUEST", "unknown docType");
  return parsed.data;
}

interface ParsedRequest {
  input: AnalysisInput;
  docType: DocType | undefined;
}

/** Reads and validates the body. Throws PipelineError with the code to answer. */
async function parseRequest(req: Request, res: Response): Promise<ParsedRequest> {
  if (typeof req.is("multipart/form-data") === "string") {
    try {
      await apply(upload, req, res);
    } catch (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        throw new PipelineError("FILE_TOO_LARGE");
      }
      throw new PipelineError("BAD_REQUEST", "unreadable multipart body");
    }
    const file = (req as Request & { file?: multer.File }).file;
    if (file?.buffer === undefined) throw new PipelineError("BAD_REQUEST", "no file field");
    const fields = (req.body ?? {}) as Record<string, unknown>;
    const docType = parseDocType(fields.docType);
    const bytes = new Uint8Array(
      file.buffer.buffer,
      file.buffer.byteOffset,
      file.buffer.byteLength,
    );
    checkPdfBytes(bytes);
    return { input: { kind: "pdf", bytes }, docType };
  }

  if (typeof req.is("application/json") === "string") {
    try {
      await apply(json, req, res);
    } catch (error) {
      const type = (error as { type?: unknown }).type;
      if (type === "entity.too.large") throw new PipelineError("TEXT_TOO_LONG");
      throw new PipelineError("BAD_REQUEST", "unreadable JSON body");
    }
    const parsed = analyzeTextRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new PipelineError("BAD_REQUEST", "body is not { text, docType? }");
    // The length, script and emptiness checks, before any stream starts.
    readPastedText(parsed.data.text);
    return { input: { kind: "text", text: parsed.data.text }, docType: parsed.data.docType };
  }

  throw new PipelineError(
    "BAD_REQUEST",
    "content type must be multipart/form-data or application/json",
  );
}

class ClientGone extends Error {
  override readonly name = "ClientGone";
}

function retryAfter(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export function analyzeRouter(deps: AnalyzeDeps): express.Router {
  const clock = deps.clock ?? systemClock;
  const daily = new DailyCounter(deps.limits.dailyAnalyses, clock);
  const router = express.Router();

  const perIp = rateLimit({
    windowMs: IP_WINDOW_MS,
    limit: deps.limits.ipAnalyses,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => {
      const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
      const resetAt = info?.resetTime?.getTime() ?? clock.now() + IP_WINDOW_MS;
      deps.logger.warn({ event: "analysis_rejected", code: "RATE_LIMITED", limit: "ip" });
      sendError(
        res,
        errorBody("RATE_LIMITED", { retryAfterSec: retryAfter(resetAt - clock.now()) }),
      );
    },
  });

  router.post("/analyze", perIp, async (req: Request, res: Response) => {
    const stream = req.query.stream !== "0";
    const started = performance.now();
    const log = deps.logger;

    let parsed: ParsedRequest;
    try {
      parsed = await parseRequest(req, res);
    } catch (error) {
      const body = toErrorBody(error);
      log.info({ event: "analysis_rejected", code: body.code, ...errorSummary(error) });
      sendError(res, body);
      return;
    }
    if (!daily.tryConsume()) {
      log.warn({ event: "analysis_rejected", code: "RATE_LIMITED", limit: "daily" });
      sendError(
        res,
        errorBody("RATE_LIMITED", { retryAfterSec: retryAfter(daily.msUntilReset()) }),
      );
      return;
    }

    const { input, docType } = parsed;
    const controller = new AbortController();
    const { signal } = controller;
    res.on("close", () => {
      if (!res.writableFinished) controller.abort(new ClientGone("client disconnected"));
    });

    log.info({
      event: "analysis_start",
      input: input.kind,
      size: input.kind === "pdf" ? input.bytes.byteLength : input.text.length,
      stream,
      ...(docType === undefined ? {} : { docType }),
    });

    let heartbeat: NodeJS.Timeout | undefined;
    const send = (event: string, data: unknown) => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };
    if (stream) {
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(": keep-alive\n\n");
      }, SSE_HEARTBEAT_MS);
      heartbeat.unref();
    }

    const scenario = scenarioFromHeader(req.headers[MOCK_SCENARIO_HEADER], deps.nodeEnv);
    let failure: ErrorBody | undefined;
    try {
      const { result, report } = await runWithMockScenario(scenario, () =>
        runAnalysis(input, {
          router: deps.router,
          maxInputTokens: deps.maxInputTokens,
          signal,
          deadline: clock.now() + deps.budgetMs,
          ...(docType === undefined ? {} : { docType }),
          onProgress: (event) => {
            if (stream) send(SSE_EVENTS.status, event);
          },
        }),
      );
      signal.throwIfAborted();
      if (stream) send(SSE_EVENTS.result, result);
      else res.status(200).json(result);
      log.info({
        event: "analysis_end",
        outcome: "ok",
        ms: Math.round(performance.now() - started),
        ...report,
        attempts: report.attempts.length,
      });
    } catch (error) {
      failure = toErrorBody(error, signal);
      log.info({
        event: "analysis_end",
        outcome: failure.code,
        ms: Math.round(performance.now() - started),
        ...errorSummary(error),
      });
    } finally {
      if (heartbeat !== undefined) clearInterval(heartbeat);
    }

    if (failure !== undefined && !res.destroyed) {
      if (stream) send(SSE_EVENTS.error, failure);
      else if (!res.headersSent) sendError(res, failure);
    }
    if (stream && !res.writableEnded) res.end();
  });

  return router;
}
