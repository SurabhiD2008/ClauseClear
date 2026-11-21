// POST /api/analyze.
//   - Body: multipart `file` (and an optional `docType` field) or JSON
//     `{ text, docType? }`. Anything else is BAD_REQUEST.
//   - Limits: per IP (express-rate-limit) and a global daily cap, both
//     RATE_LIMITED with retryAfterSec, answered before any stream starts.
//   - Response: server-sent events by default, plain JSON with ?stream=0.
//     Errors found before the stream starts use the HTTP status; after that
//     they are an `error` event.
//   - A client disconnect aborts the run: no further provider calls start.
// Logs carry counts, durations and codes, never text.
import { performance } from "node:perf_hooks";
import { IP_WINDOW_MS, SSE_EVENTS, errorBody, type ErrorBody } from "@clauseclear/shared";
import express, { type Request, type RequestHandler, type Response } from "express";

export { JSON_BODY_LIMIT } from "./analyzeRequest.js";
import { rateLimit, type RateLimitInfo } from "express-rate-limit";
import type { LimitsConfig } from "../config.js";
import {
  MOCK_SCENARIO_HEADER,
  runWithMockScenario,
  scenarioFromHeader,
  type LlmRouter,
} from "../llm/index.js";
import { DailyCounter, systemClock, type Clock } from "../llm/limiter.js";
import type { Logger } from "../logger.js";
import { runAnalysis } from "../pipeline/run.js";
import { parseRequest, type ParsedRequest } from "./analyzeRequest.js";
import { errorSummary, sendError, toErrorBody } from "./errors.js";

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

class ClientGone extends Error {
  override readonly name = "ClientGone";
}

function retryAfter(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/** The per-IP limit: RATE_LIMITED with the seconds until the window frees a slot. */
function perIpLimiter(deps: AnalyzeDeps, clock: Clock): RequestHandler {
  return rateLimit({
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
}

/** Validates the body and takes a slot of the daily cap; answers the refusal itself. */
async function admit(
  req: Request,
  res: Response,
  daily: DailyCounter,
  log: Logger,
): Promise<ParsedRequest | undefined> {
  let parsed: ParsedRequest;
  try {
    parsed = await parseRequest(req, res);
  } catch (error) {
    const body = toErrorBody(error);
    log.info({ event: "analysis_rejected", code: body.code, ...errorSummary(error) });
    sendError(res, body);
    return undefined;
  }
  if (!daily.tryConsume()) {
    log.warn({ event: "analysis_rejected", code: "RATE_LIMITED", limit: "daily" });
    sendError(res, errorBody("RATE_LIMITED", { retryAfterSec: retryAfter(daily.msUntilReset()) }));
    return undefined;
  }
  return parsed;
}

interface Channel {
  send(event: string, data: unknown): void;
  stop(): void;
}

/** Starts the event stream (headers and heartbeat) when streaming; send is safe after close. */
function openChannel(res: Response, stream: boolean): Channel {
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
  return {
    send,
    stop: () => {
      if (heartbeat !== undefined) clearInterval(heartbeat);
    },
  };
}

interface RunContext {
  deps: AnalyzeDeps;
  clock: Clock;
  parsed: ParsedRequest;
  stream: boolean;
  channel: Channel;
  signal: AbortSignal;
  scenario: ReturnType<typeof scenarioFromHeader>;
  started: number;
}

/** Runs the analysis and sends the result; returns the error body if it failed. */
async function runAndAnswer(res: Response, ctx: RunContext): Promise<ErrorBody | undefined> {
  const { deps, parsed, stream, channel, signal } = ctx;
  const log = deps.logger;
  try {
    const { result, report } = await runWithMockScenario(ctx.scenario, () =>
      runAnalysis(parsed.input, {
        router: deps.router,
        maxInputTokens: deps.maxInputTokens,
        signal,
        deadline: ctx.clock.now() + deps.budgetMs,
        ...(parsed.docType === undefined ? {} : { docType: parsed.docType }),
        onProgress: (event) => {
          if (stream) channel.send(SSE_EVENTS.status, event);
        },
      }),
    );
    signal.throwIfAborted();
    if (stream) channel.send(SSE_EVENTS.result, result);
    else res.status(200).json(result);
    const ms = Math.round(performance.now() - ctx.started);
    log.info({
      event: "analysis_end",
      outcome: "ok",
      ms,
      ...report,
      attempts: report.attempts.length,
    });
    return undefined;
  } catch (error) {
    const failure = toErrorBody(error, signal);
    const ms = Math.round(performance.now() - ctx.started);
    log.info({ event: "analysis_end", outcome: failure.code, ms, ...errorSummary(error) });
    return failure;
  } finally {
    channel.stop();
  }
}

export function analyzeRouter(deps: AnalyzeDeps): express.Router {
  const clock = deps.clock ?? systemClock;
  const daily = new DailyCounter(deps.limits.dailyAnalyses, clock);
  const router = express.Router();

  router.post("/analyze", perIpLimiter(deps, clock), async (req: Request, res: Response) => {
    const stream = req.query.stream !== "0";
    const started = performance.now();
    const parsed = await admit(req, res, daily, deps.logger);
    if (parsed === undefined) return;

    const { input, docType } = parsed;
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort(new ClientGone("client disconnected"));
    });
    deps.logger.info({
      event: "analysis_start",
      input: input.kind,
      size: input.kind === "pdf" ? input.bytes.byteLength : input.text.length,
      stream,
      ...(docType === undefined ? {} : { docType }),
    });

    const channel = openChannel(res, stream);
    const scenario = scenarioFromHeader(req.headers[MOCK_SCENARIO_HEADER], deps.nodeEnv);
    const ctx = {
      deps,
      clock,
      parsed,
      stream,
      channel,
      signal: controller.signal,
      scenario,
      started,
    };
    const failure = await runAndAnswer(res, ctx);
    if (failure !== undefined && !res.destroyed) {
      if (stream) channel.send(SSE_EVENTS.error, failure);
      else if (!res.headersSent) sendError(res, failure);
    }
    if (stream && !res.writableEnded) res.end();
  });
  return router;
}
