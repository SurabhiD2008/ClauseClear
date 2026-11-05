// A hard cap on real model calls for a script run (A91, A96). Each provider is
// wrapped; once the cap is spent, calls fail with a "request" error without
// reaching the network, so the router gives up instead of retrying.
import { LlmError, type LlmProvider } from "../server/src/llm/provider.js";

/** Thrown instead of calling the provider once the run's call budget is spent. */
export class CallBudgetExhausted extends LlmError {
  override readonly name = "CallBudgetExhausted";
  readonly kind = "request";
}

export interface CallBudget {
  readonly max: number;
  readonly made: number;
  readonly blocked: number;
  /** True once after each refused call, so a log hook can skip its entry. */
  takeBlocked: () => boolean;
  wrap: (provider: LlmProvider) => LlmProvider;
}

export function callBudget(max: number): CallBudget {
  let made = 0;
  let blocked = 0;
  let blockedPending = false;
  return {
    max,
    get made() {
      return made;
    },
    get blocked() {
      return blocked;
    },
    takeBlocked() {
      const was = blockedPending;
      blockedPending = false;
      return was;
    },
    wrap: (provider) => ({
      name: provider.name,
      model: provider.model,
      generateJson(request) {
        if (made >= max) {
          blocked += 1;
          blockedPending = true;
          return Promise.reject(new CallBudgetExhausted(provider.name, "live call budget spent"));
        }
        made += 1;
        return provider.generateJson(request);
      },
    }),
  };
}

/** Parses --max-calls: a positive integer, or the default. */
export function maxCallsArg(value: string | undefined, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 1) {
    console.error("--max-calls must be a positive integer.");
    process.exit(1);
  }
  return n;
}
