// POST /api/translate (SPEC section 7, section 6 step 11). Accepts only the keys
// extractTranslatable produces, so quotes and segments can never be sent to a
// model (A18). Answers { strings, unchanged }: every key comes back, in Hindi
// when it passed the number check, otherwise in English and listed in unchanged.
import {
  errorBody,
  estimateTokens,
  IP_WINDOW_MS,
  isTranslatableKey,
  translateRequestSchema,
  TRANSLATE_MAX_REQUEST_TOKENS,
  type TranslateResponse,
} from "@clauseclear/shared";
import express, { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { LlmRouter } from "../llm/index.js";
import { systemClock, type Clock } from "../llm/limiter.js";
import type { Logger } from "../logger.js";
import { translateStrings } from "../translate/translate.js";
import { errorSummary, sendError, toErrorBody } from "./errors.js";

/** Translatable strings of one result stay far below this. */
export const TRANSLATE_BODY_LIMIT = "1mb";

export interface TranslateDeps {
  router: LlmRouter;
  budgetMs: number;
  /** Requests per IP per IP_WINDOW_MS (A99: the analyze limit, counted separately). */
  ipLimit: number;
  logger: Logger;
  clock?: Clock;
}

class ClientGone extends Error {
  override readonly name = "ClientGone";
}

export function translateRouter(deps: TranslateDeps): express.Router {
  const clock = deps.clock ?? systemClock;
  const router = express.Router();
  const perIp = rateLimit({
    windowMs: IP_WINDOW_MS,
    limit: deps.ipLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      deps.logger.warn({ event: "translate_rejected", code: "RATE_LIMITED", limit: "ip" });
      sendError(res, errorBody("RATE_LIMITED", { retryAfterSec: Math.ceil(IP_WINDOW_MS / 1000) }));
    },
  });

  router.post(
    "/translate",
    perIp,
    express.json({ limit: TRANSLATE_BODY_LIMIT }),
    async (req: Request, res: Response) => {
      const log = deps.logger;
      const parsed = translateRequestSchema.safeParse(req.body);
      const keys = parsed.success ? Object.keys(parsed.data.strings) : [];
      const tokens = parsed.success
        ? Object.entries(parsed.data.strings).reduce(
            (sum, [k, v]) => sum + estimateTokens(k) + estimateTokens(v),
            0,
          )
        : 0;
      const reason = !parsed.success
        ? "schema"
        : keys.some((k) => !isTranslatableKey(k))
          ? "key"
          : tokens > TRANSLATE_MAX_REQUEST_TOKENS
            ? "size"
            : undefined;
      if (!parsed.success || reason !== undefined) {
        log.info({ event: "translate_rejected", code: "BAD_REQUEST", reason });
        sendError(res, errorBody("BAD_REQUEST"));
        return;
      }

      const controller = new AbortController();
      const { signal } = controller;
      res.on("close", () => {
        if (!res.writableFinished) controller.abort(new ClientGone("client disconnected"));
      });
      const started = performance.now();
      try {
        const outcome = await translateStrings(parsed.data.strings, {
          router: deps.router,
          signal,
          deadline: clock.now() + deps.budgetMs,
        });
        log.info({
          event: "translate_end",
          code: "OK",
          ms: Math.round(performance.now() - started),
          strings: keys.length,
          estTokens: tokens,
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
          ms: Math.round(performance.now() - started),
          strings: keys.length,
          ...errorSummary(error),
        });
        if (!signal.aborted && !res.headersSent) sendError(res, body);
      }
    },
  );
  return router;
}
