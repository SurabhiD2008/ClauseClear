// Helpers for the API tests: an app over the recording mock router, a logger
// whose output is captured, and an SSE parser.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { DestinationStream } from "pino";
import { createApp, type AppOptions } from "../../app.js";
import { createLogger } from "../../logger.js";
import {
  recordingRouter,
  type Recorder,
  type RecorderOptions,
} from "../../pipeline/testing/harness.js";

/** The unique string inside fixtures/docs/log-canary.pdf (scripts/build-fixtures.ts). */
export const LOG_CANARY = "QUOKKA-CANARY-7Q4X";

export const docsDir = fileURLToPath(new URL("../../../../fixtures/docs/", import.meta.url));
export const doc = (name: string) => `${docsDir}${name}`;
export const docBytes = async (name: string) => readFile(doc(name));

export interface TestApp {
  app: ReturnType<typeof createApp>;
  recorder: Recorder;
  /** Every log line written so far, as raw JSON text. */
  logs: () => string;
  logLines: () => Record<string, unknown>[];
}

export function testApp(
  options: { recorder?: RecorderOptions; app?: Partial<AppOptions> } = {},
): TestApp {
  const recorder = recordingRouter(options.recorder);
  const chunks: string[] = [];
  const destination: DestinationStream = {
    write(chunk: string) {
      chunks.push(chunk);
    },
  };
  const app = createApp({
    router: recorder.router,
    maxInputTokens: 24_000,
    budgetMs: 100_000,
    limits: { ipAnalyses: 1_000, dailyAnalyses: 1_000 },
    logger: createLogger({ level: "info", destination }),
    nodeEnv: "test",
    ...options.app,
  });
  return {
    app,
    recorder,
    logs: () => chunks.join(""),
    logLines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

export interface SseEvent {
  event: string;
  data: unknown;
}

/** Parses a text/event-stream body; comments (heartbeats) are skipped. */
export function parseSse(body: string): SseEvent[] {
  return body
    .split("\n\n")
    .filter((block) => block.trim() !== "" && !block.startsWith(":"))
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "message";
      const data = lines
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      return { event, data: JSON.parse(data) as unknown };
    });
}

/** Pasted legal-looking text of the given length, English only. */
export function legalText(chars: number): string {
  const sentence =
    "The Licensee shall pay the monthly license fee on time and keep the premises in good repair. ";
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars);
}
