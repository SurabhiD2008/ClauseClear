import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorBody } from "@clauseclear/shared";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { readServerConfig, type LimitsConfig } from "./config.js";
import { createLlmRouter, readLlmConfig, type LlmRouter } from "./llm/index.js";
import type { Clock } from "./llm/limiter.js";
import { logger as defaultLogger, type Logger } from "./logger.js";
import { analyzeRouter } from "./routes/analyze.js";
import { errorSummary, sendError } from "./routes/errors.js";
import { healthRouter } from "./routes/health.js";
import { samplesRouter } from "./routes/samples.js";
import { IMMUTABLE, compressedAssets } from "./staticAssets.js";
import { translateRouter } from "./routes/translate.js";

/** Same relative path from server/src (tsx) and server/dist (node). */
export const DEFAULT_SAMPLES_DIR = fileURLToPath(
  new URL("../../fixtures/samples/", import.meta.url),
);

/** Device features the app never uses, refused for every page (A176). */
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()";

export interface AppOptions {
  /** Absolute path to the built client. Set in production only; in dev Vite serves the client. */
  clientDist?: string;
  /** Each defaults to the value read from process.env; tests inject their own. */
  router?: LlmRouter;
  maxInputTokens?: number;
  budgetMs?: number;
  limits?: Partial<LimitsConfig>;
  trustProxy?: number;
  logger?: Logger;
  samplesDir?: string;
  nodeEnv?: string;
  clock?: Clock;
  /**
   * Test only: a folder of deliberately broken pages served at /__guard/, so the
   * end-to-end oddity guard can show each of its checks failing (prompt 16).
   * index.ts sets it only when E2E_GUARD_PAGES=1; it is never set otherwise.
   */
  guardPagesDir?: string;
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express();
  const server = readServerConfig(process.env);
  const llm =
    options.maxInputTokens === undefined || options.budgetMs === undefined
      ? readLlmConfig(process.env)
      : undefined;
  const log = options.logger ?? defaultLogger;

  app.disable("x-powered-by");
  // Only hops we were told about may set the client IP the per-IP limit uses.
  app.set("trust proxy", options.trustProxy ?? server.trustProxy);

  // Strict CSP from SPEC section 11. Helmet's defaults are replaced, not merged,
  // because they allow inline styles and https: sources.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  // Prompt 19 header probe (A176). The page uses no device features, so none
  // may be granted to it or to anything framed in it.
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    next();
  });
  // API answers carry document text and quotes: no browser or proxy may keep
  // them (SPEC section 11, no result caching). Streams set their own no-store.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Throws on an invalid sample, so the server never starts with one (A98).
  const samples = samplesRouter(options.samplesDir ?? DEFAULT_SAMPLES_DIR);
  const router = options.router ?? createLlmRouter(process.env);
  const limits = { ...server.limits, ...options.limits };
  const budgetMs = options.budgetMs ?? llm?.budgetMs ?? 0;

  app.use("/api", healthRouter);
  app.use("/api", samples);
  app.use(
    "/api",
    analyzeRouter({
      router,
      maxInputTokens: options.maxInputTokens ?? llm?.maxInputTokens ?? 0,
      budgetMs,
      limits,
      logger: log,
      nodeEnv: options.nodeEnv ?? process.env.NODE_ENV,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
  );
  app.use(
    "/api",
    translateRouter({
      router,
      budgetMs,
      ipLimit: limits.ipAnalyses,
      logger: log,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
  );
  // Unknown API paths must not fall through to the SPA's index.html.
  app.use("/api", (_req, res) => {
    sendError(res, errorBody("NOT_FOUND"));
  });

  if (options.guardPagesDir !== undefined) {
    // The same CSP except connect-src, which lets the network page reach other
    // local origins so the guard can be shown catching such requests.
    app.use(
      "/__guard",
      express.static(options.guardPagesDir, {
        index: false,
        setHeaders: (res) => {
          const csp = String(res.getHeader("Content-Security-Policy") ?? "");
          res.setHeader(
            "Content-Security-Policy",
            csp.replace(
              "connect-src 'self'",
              "connect-src 'self' http://localhost:* http://127.0.0.1:*",
            ),
          );
        },
      }),
    );
  }

  const { clientDist } = options;
  if (clientDist !== undefined) {
    // Text assets compressed in memory; fonts and the rest through express.static (A179).
    const assets = compressedAssets(clientDist);
    app.use(assets.middleware);
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}assets${path.sep}`))
            res.setHeader("Cache-Control", IMMUTABLE);
        },
      }),
    );
    app.get("/{*path}", (req, res) => {
      assets.sendIndex(req, res);
    });
  }

  // Bodies that fail to parse are the client's fault; anything else is ours.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = (error as { status?: unknown }).status;
    const clientError = typeof status === "number" && status >= 400 && status < 500;
    log.warn({ event: "request_failed", clientError, ...errorSummary(error) });
    sendError(res, errorBody(clientError ? "BAD_REQUEST" : "ANALYSIS_FAILED"));
  });

  return app;
}
