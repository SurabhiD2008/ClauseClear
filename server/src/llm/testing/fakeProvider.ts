// An in-memory provider for router tests. Each call takes the next step from a
// script (the last step repeats); the step returns text, throws an error, or
// waits on a promise the test controls. Calls and peak concurrency are recorded.
import type { GenerateJsonRequest, GenerateJsonResult, LlmProvider } from "../provider.js";

export type Step =
  | string
  | Error
  | ((request: GenerateJsonRequest) => Promise<GenerateJsonResult> | GenerateJsonResult);

export interface FakeProvider extends LlmProvider {
  calls: GenerateJsonRequest[];
  inFlight: number;
  peakInFlight: number;
}

export function fakeProvider(name: string, ...steps: Step[]): FakeProvider {
  const script = steps.length === 0 ? ['{"ok":true}'] : [...steps];
  const provider: FakeProvider = {
    name,
    model: `${name}-model`,
    calls: [],
    inFlight: 0,
    peakInFlight: 0,
    async generateJson(request) {
      provider.calls.push(request);
      const step = script.length > 1 ? script.shift() : script[0];
      provider.inFlight += 1;
      provider.peakInFlight = Math.max(provider.peakInFlight, provider.inFlight);
      try {
        if (step instanceof Error) throw step;
        if (typeof step === "function") return await step(request);
        return { text: step ?? "" };
      } finally {
        provider.inFlight -= 1;
      }
    },
  };
  return provider;
}

/** Waits until the signal aborts, then rejects with its reason, like fetch does. */
export function hangUntilAborted(request: GenerateJsonRequest): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    request.signal?.addEventListener(
      "abort",
      () => {
        reject(request.signal?.reason as Error);
      },
      { once: true },
    );
  });
}

/** Resolves with text after ms of (fake) time unless aborted first. */
export function answerAfter(ms: number, text: string) {
  return (request: GenerateJsonRequest): Promise<GenerateJsonResult> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({ text });
      }, ms);
      request.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(request.signal?.reason as Error);
        },
        { once: true },
      );
    });
}
