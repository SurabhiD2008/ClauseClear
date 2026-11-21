// Structured logs. Callers log counts,
// durations, statuses and error codes only. Redaction is a second line of
// defence in case a key-shaped field is ever passed by mistake.
import pino, { type DestinationStream, type Logger } from "pino";
import { nodeEnvOf } from "./config.js";

export type { Logger } from "pino";

const REDACT_PATHS = [
  "apiKey",
  "*.apiKey",
  "key",
  "*.key",
  "authorization",
  "*.authorization",
  "headers",
  "*.headers",
  "text",
  "*.text",
  "quote",
  "*.quote",
];

/** A logger with the shared redaction. Tests pass a destination to capture the output. */
export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  const settings = {
    level: options.level ?? (nodeEnvOf(process.env) === "test" ? "silent" : "info"),
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  return options.destination === undefined ? pino(settings) : pino(settings, options.destination);
}

export const logger = createLogger();
