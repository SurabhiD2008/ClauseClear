// Test doubles for the client stores: an API whose streams the test drives by
// hand, an in-memory sessionStorage and a language store that needs no DOM.
import {
  validResult,
  type AnalysisResult,
  type SampleResponse,
  type TranslateResponse,
  type TranslationMap,
} from "@clauseclear/shared";
import hi from "../i18n/hi.json";
import type { Api, AnalyzeInput, StreamOptions } from "../lib/api";
import type { AnalyzeEvent } from "../lib/sse";
import { createAppStores } from "./app";
import { createLanguageStore } from "./language";
import type { TickStorage } from "./ui";

export interface ControlledRun {
  input: AnalyzeInput;
  signal: AbortSignal;
  /** Delivers an event even after an abort, like a chunk already in the buffer. */
  emit: (event: AnalyzeEvent) => void;
  finish: () => void;
  fail: (error: unknown) => void;
}

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal | undefined;
}

export function controlledApi() {
  const runs: ControlledRun[] = [];
  const samples: (Deferred<SampleResponse> & { id: string })[] = [];
  const translations: (Deferred<TranslateResponse> & { strings: TranslationMap })[] = [];

  const api: Api = {
    streamAnalysis: (input: AnalyzeInput, options: StreamOptions) =>
      new Promise<void>((resolve, reject) => {
        runs.push({
          input,
          signal: options.signal,
          emit: options.onEvent,
          finish: resolve,
          fail: reject,
        });
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    listSamples: () => Promise.resolve([]),
    getSample: (id, signal) =>
      new Promise((resolve, reject) => {
        samples.push({ id, resolve, reject, signal });
      }),
    translate: (strings, signal) =>
      new Promise((resolve, reject) => {
        translations.push({ strings, resolve, reject, signal });
      }),
  };
  return { api, runs, samples, translations };
}

export function memorySession(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: TickStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { data, storage };
}

export function setupApp(session = memorySession()) {
  const controlled = controlledApi();
  const language = createLanguageStore({
    storage: null,
    root: null,
    loadHindi: () => Promise.resolve(hi),
  });
  const app = createAppStores({
    api: controlled.api,
    language,
    tickStorage: session.storage,
    newRunAnalysisId: (runId) => `run:test-${String(runId)}`,
  });
  return { app, session, ...controlled };
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 200+ characters of English, enough to pass the client's length check. */
export const LONG_TEXT = "The tenant shall pay rent on the first day of each month. ".repeat(5);

export function resultTitled(title: string): AnalysisResult {
  return { ...validResult(), title };
}
