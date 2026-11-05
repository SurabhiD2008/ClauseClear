// Translate on demand (SPEC section 6 step 11, section 5 call budget). Strings
// are packed into batches of about TRANSLATE_BATCH_TOKENS, one call each. Every
// output is checked against its input's numbers; mismatched or missing keys get
// one more call, and anything still wrong stays English and is reported.
import {
  estimateTokens,
  TRANSLATE_BATCH_TOKENS,
  TRANSLATE_MAX_OUTPUT_TOKENS,
  TRANSLATION_RETRIES,
  type TranslationMap,
} from "@clauseclear/shared";
import { z } from "zod";
import { zodOutput, type LlmRouter } from "../llm/index.js";
import { keepsNumbers } from "./check.js";
import { buildTranslatePrompts } from "./prompts.js";

const outputSchema = z.record(z.string(), z.string());

export interface TranslateOptions {
  router: LlmRouter;
  signal?: AbortSignal;
  deadline?: number;
  batchTokens?: number;
}

export interface TranslateOutcome {
  /** Every input key: Hindi when it passed the check, otherwise the English. */
  strings: TranslationMap;
  /** Keys that stayed English, in input order. */
  unchanged: string[];
  calls: number;
  /** Keys sent a second time. */
  retried: number;
}

/** Estimated tokens one entry adds to the JSON data block. */
export function entryTokens(key: string, value: string): number {
  return estimateTokens(`${JSON.stringify(key)}:${JSON.stringify(value)},`);
}

/** Packs entries in order into batches of at most `limit` tokens; a bigger entry goes alone. */
export function batchStrings(
  strings: TranslationMap,
  limit = TRANSLATE_BATCH_TOKENS,
): TranslationMap[] {
  const batches: TranslationMap[] = [];
  let current: TranslationMap = {};
  let size = 0;
  for (const [key, value] of Object.entries(strings)) {
    const tokens = entryTokens(key, value);
    if (size > 0 && size + tokens > limit) {
      batches.push(current);
      current = {};
      size = 0;
    }
    current[key] = value;
    size += tokens;
  }
  if (size > 0) batches.push(current);
  return batches;
}

export async function translateStrings(
  strings: TranslationMap,
  options: TranslateOptions,
): Promise<TranslateOutcome> {
  const { router, signal, deadline } = options;
  const callOptions = {
    ...(signal === undefined ? {} : { signal }),
    ...(deadline === undefined ? {} : { deadline }),
  };
  const result: TranslationMap = {};
  // A string with no letters (an amount, a date) is kept as it is, with no call.
  let pending: TranslationMap = {};
  for (const [key, value] of Object.entries(strings)) {
    if (/[A-Za-z]/.test(value)) pending[key] = value;
    else result[key] = value;
  }

  let calls = 0;
  let retried = 0;
  for (let attempt = 0; attempt <= TRANSLATION_RETRIES; attempt += 1) {
    if (Object.keys(pending).length === 0) break;
    if (attempt > 0) retried += Object.keys(pending).length;
    const batches = batchStrings(pending, options.batchTokens);
    calls += batches.length;
    const answers = await Promise.all(
      batches.map(async (batch) => {
        const { value } = await router.generate(
          {
            ...buildTranslatePrompts(batch, attempt > 0),
            schemaName: "translation",
            maxOutputTokens: TRANSLATE_MAX_OUTPUT_TOKENS,
          },
          zodOutput(outputSchema),
          callOptions,
        );
        return value;
      }),
    );
    const next: TranslationMap = {};
    batches.forEach((batch, index) => {
      const answer = answers[index] ?? {};
      for (const [key, english] of Object.entries(batch)) {
        // Extra keys in the answer are ignored; only the keys asked for are read.
        const hindi = Object.hasOwn(answer, key) ? answer[key] : undefined;
        if (hindi !== undefined && hindi.trim() !== "" && keepsNumbers(english, hindi)) {
          result[key] = hindi;
        } else {
          next[key] = english;
        }
      }
    });
    pending = next;
  }

  const unchanged = Object.keys(strings).filter((key) => Object.hasOwn(pending, key));
  const ordered: TranslationMap = {};
  for (const key of Object.keys(strings)) {
    ordered[key] = Object.hasOwn(pending, key) ? (strings[key] ?? "") : (result[key] ?? "");
  }
  return { strings: ordered, unchanged, calls, retried };
}
