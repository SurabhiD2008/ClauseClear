// POST /api/translate. Accepts only the keys
// extractTranslatable produces, so quotes and segments can never be sent to a
// model. Answers { strings, unchanged }: every key comes back, in Hindi
// when it passed the number check, otherwise in English and listed in unchanged.
import {
  CHARS_PER_TOKEN,
  errorBody,
  estimateTokens,
  IP_WINDOW_MS,
  isTranslatableKey,
  translateRequestSchema,
  TRANSLATE_MAX_REQUEST_TOKENS,
  type TranslateResponse,
  type TranslationMap,
} from "@clauseclear/shared";
import express, { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { LlmRouter } from "../llm/index.js";
import { DailyCounter, systemClock, type Clock } from "../llm/limiter.js";
import type { Logger } from "../logger.js";
import { translateStrings } from "../translate/translate.js";
import { errorSummary, sendError, toErrorBody } from "./errors.js";

/**
 * Largest body read, in bytes: the biggest request the token cap allows, every
 * character escaped as \uXXXX (6 bytes), plus room for the envelope. Anything
 * bigger is refused before it is parsed.
 */
export const TRANSLATE_BODY_LIMIT = TRANSLATE_MAX_REQUEST_TOKENS * CHARS_PER_TOKEN * 6 + 16_384;

export interface TranslateDeps {
  router: LlmRouter;
  budgetMs: number;
  /** Requests per IP per IP_WINDOW_MS (the analyze limit, counted separately). */
  ipLimit: number;
  /** Translation requests across the server per day; each can cost model calls. */
  dailyLimit: number;
  logger: Logger;
  clock?: Clock;
}

class ClientGone extends Error {
  override readonly name = "ClientGone";
}

type Checked =
  | { ok: true; strings: TranslationMap; keys: string[]; tokens: number }
  | { ok: false; reason: "schema" | "key" | "size" };

/** Accepts only translatable keys, within the request token cap. */
function checkRequest(body: unknown): Checked {
  const parsed = translateRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "schema" };
  const { strings } = parsed.data;
  const keys = Object.keys(strings);
  if (keys.some((k) => !isTranslatableKey(k))) return { ok: false, reason: "key" };
  const tokens = Object.entries(strings).reduce(
    (sum, [k, v]) => sum + estimateTokens(k) + estimateTokens(v),
    0,
  );
  if (tokens > TRANSLATE_MAX_REQUEST_TOKENS) return { ok: false, reason: "size" };
  return { ok: true, strings, keys, tokens };
}

function perIpLimiter(deps: TranslateDeps) {
  return rateLimit({
    windowMs: IP_WINDOW_MS,
    limit: deps.ipLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      deps.logger.warn({ event: "translate_rejected", code: "RATE_LIMITED", limit: "ip" });
      sendError(res, errorBody("RATE_LIMITED", { retryAfterSec: Math.ceil(IP_WINDOW_MS / 1000) }));
    },
  });
}

/** Translates and answers; a client that left gets nothing and stops the work. */
async function translateAndAnswer(
  res: Response,
  request: Extract<Checked, { ok: true }>,
  deps: TranslateDeps,
  clock: Clock,
): Promise<void> {
  const log = deps.logger;
  const controller = new AbortController();
  const { signal } = controller;
  res.on("close", () => {
    if (!res.writableFinished) controller.abort(new ClientGone("client disconnected"));
  });
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const outcome = await translateStrings(request.strings, {
      router: deps.router,
      signal,
      deadline: clock.now() + deps.budgetMs,
    });
    log.info({
      event: "translate_end",
      code: "OK",
      ms: ms(),
      strings: request.keys.length,
      estTokens: request.tokens,
      calls: outcome.calls,
      retried: outcome.retried,
      unchanged: outcome.unchanged.length,
    });
    const body: TranslateResponse = { strings: outcome.strings, unchanged: outcome.unchanged };
    res.json(body);
  } catch (error) {
    const body = toErrorBody(error, signal);
    log.warn({
      event: "translate_end",
      code: body.code,
      ms: ms(),
      strings: request.keys.length,
      ...errorSummary(error),
    });
    if (!signal.aborted && !res.headersSent) sendError(res, body);
  }
}

export function translateRouter(deps: TranslateDeps): express.Router {
  const clock = deps.clock ?? systemClock;
  const router = express.Router();
  const daily = new DailyCounter(deps.dailyLimit, clock);
  router.post(
    "/translate",
    perIpLimiter(deps),
    express.json({ limit: TRANSLATE_BODY_LIMIT }),
    async (req: Request, res: Response) => {
      const checked = checkRequest(req.body);
      if (!checked.ok) {
        deps.logger.info({
          event: "translate_rejected",
          code: "BAD_REQUEST",
          reason: checked.reason,
        });
        sendError(res, errorBody("BAD_REQUEST"));
        return;
      }
      // Counted only for valid, non-empty requests: an empty map costs no call.
      if (checked.keys.length > 0 && !daily.tryConsume()) {
        deps.logger.warn({ event: "translate_rejected", code: "RATE_LIMITED", limit: "daily" });
        const retryAfterSec = Math.max(1, Math.ceil(daily.msUntilReset() / 1000));
        sendError(res, errorBody("RATE_LIMITED", { retryAfterSec }));
        return;
      }
      await translateAndAnswer(res, checked, deps, clock);
    },
  );
  return router;
}
