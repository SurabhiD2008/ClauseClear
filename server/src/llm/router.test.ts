import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zodOutput } from "./json.js";
import {
  AuthError,
  RateLimitError,
  RequestError,
  TimeoutError,
  TransientError,
} from "./provider.js";
import {
  LlmRouter,
  LlmRouterError,
  type LlmLogEntry,
  type RoutedProvider,
  type RouterOptions,
} from "./router.js";
import {
  answerAfter,
  fakeProvider,
  hangUntilAborted,
  type FakeProvider,
} from "./testing/fakeProvider.js";

const OK = '{"ok":true}';
const output = zodOutput(z.strictObject({ ok: z.literal(true) }));
const request = {
  system: "system rules",
  user: "the document",
  schemaName: "test",
  maxOutputTokens: 100,
};

function routed(provider: FakeProvider, limits: Partial<RoutedProvider> = {}): RoutedProvider {
  return { provider, rpm: 1000, rpdBudget: 1000, ...limits };
}

function makeRouter(
  providers: (FakeProvider | RoutedProvider)[],
  overrides: Partial<RouterOptions> = {},
) {
  const logs: LlmLogEntry[] = [];
  const router = new LlmRouter({
    providers: providers.map((p) => ("provider" in p ? p : routed(p))),
    concurrency: 2,
    timeoutMs: 45_000,
    budgetMs: 100_000,
    // 0.5 means zero jitter, so backoff steps are exact.
    random: () => 0.5,
    log: (entry) => logs.push(entry),
    ...overrides,
  });
  return { router, logs };
}

/** Captures the settled value so a rejection is never unhandled while timers run. */
function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

async function expectRouterError(promise: Promise<unknown>, code: string) {
  const outcome = await settle(promise);
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return undefined;
  expect(outcome.error).toBeInstanceOf(LlmRouterError);
  expect((outcome.error as LlmRouterError).code).toBe(code);
  return outcome.error as LlmRouterError;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T12:00:00-08:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fallback order", () => {
  it("uses the first provider when it answers, and logs the call without text", async () => {
    const a = fakeProvider("a", OK);
    const b = fakeProvider("b", OK);
    const { router, logs } = makeRouter([a, b]);
    const result = await router.generate(request, output);
    expect(result).toMatchObject({ value: { ok: true }, provider: "a", model: "a-model" });
    expect(b.calls).toHaveLength(0);
    expect(logs).toEqual([
      expect.objectContaining({ event: "llm_call", provider: "a", outcome: "ok", repair: false }),
    ]);
    expect(JSON.stringify(logs)).not.toContain("the document");
  });

  it("follows LLM_PROVIDER_ORDER: a 500 moves to the next provider in order", async () => {
    const a = fakeProvider("a", new TransientError("a", "HTTP 500", 500));
    const b = fakeProvider("b", new TransientError("b", "HTTP 503", 503));
    const c = fakeProvider("c", OK);
    const { router } = makeRouter([a, b, c]);
    const result = await router.generate(request, output);
    expect(result.provider).toBe("c");
    expect([a.calls.length, b.calls.length, c.calls.length]).toEqual([1, 1, 1]);
  });

  it("429 with Retry-After: falls back at once to the next provider", async () => {
    const a = fakeProvider("a", new RateLimitError("a", 30_000));
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([a, b]);
    const result = await router.generate(request, output);
    expect(result.provider).toBe("b");
  });

  it("429 with Retry-After: retries that provider only after Retry-After has passed", async () => {
    const a = fakeProvider("a", new RateLimitError("a", 5_000), OK);
    const { router } = makeRouter([a]);
    const pending = settle(router.generate(request, output));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(a.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.calls).toHaveLength(2);
    expect(await pending).toMatchObject({ ok: true, value: { provider: "a" } });
  });

  it("429 without Retry-After: backs off 2 s, 4 s, then 8 s", async () => {
    const limited = new RateLimitError("a");
    const a = fakeProvider("a", limited, limited, limited, OK);
    const { router } = makeRouter([a]);
    const pending = settle(router.generate(request, output));
    const callsAt = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return a.calls.length;
    };
    expect(await callsAt(1_999)).toBe(1);
    expect(await callsAt(1)).toBe(2);
    expect(await callsAt(3_999)).toBe(2);
    expect(await callsAt(1)).toBe(3);
    expect(await callsAt(7_999)).toBe(3);
    expect(await callsAt(1)).toBe(4);
    expect(await pending).toMatchObject({ ok: true });
  });

  it("backoff jitter stays within plus or minus 25 percent", async () => {
    for (const [random, expected] of [
      [0, 1_500],
      [0.999_999, 2_500],
    ] as const) {
      const a = fakeProvider("a", new RateLimitError("a"), OK);
      const { router } = makeRouter([a], { random: () => random });
      const pending = settle(router.generate(request, output));
      await vi.advanceTimersByTimeAsync(expected - 1);
      expect(a.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(a.calls).toHaveLength(2);
      await pending;
    }
  });

  it("gives up after three retries and returns RATE_LIMITED with retryAfterSec", async () => {
    const a = fakeProvider("a", new RateLimitError("a"));
    const { router } = makeRouter([a]);
    const pending = expectRouterError(router.generate(request, output), "RATE_LIMITED");
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await pending;
    expect(a.calls).toHaveLength(4);
    expect(error?.retryAfterSec).toBe(8);
    // Rate limits are handled by Retry-After and backoff; they never open the breaker.
    expect(router.breakerStates().a).toBe("closed");
  });

  it("timeout: the per-call timeout fires and the next provider answers", async () => {
    const a = fakeProvider("a", hangUntilAborted);
    const b = fakeProvider("b", OK);
    const { router, logs } = makeRouter([a, b]);
    const pending = settle(router.generate(request, output));
    await vi.advanceTimersByTimeAsync(44_999);
    expect(b.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: true, value: { provider: "b" } });
    expect(a.calls[0]?.signal?.reason).toBeInstanceOf(TimeoutError);
    expect(logs[0]).toMatchObject({ provider: "a", outcome: "timeout", latencyMs: 45_000 });
  });

  it("malformed JSON moves to the next provider without a repair call", async () => {
    const a = fakeProvider("a", "{ this is not JSON");
    const b = fakeProvider("b", OK);
    const { router, logs } = makeRouter([a, b]);
    expect((await router.generate(request, output)).provider).toBe("b");
    expect(a.calls).toHaveLength(1);
    expect(logs[0]).toMatchObject({ outcome: "bad_output", reason: "malformed" });
  });

  it("truncated JSON moves to the next provider", async () => {
    const a = fakeProvider("a", '{"ok": tr');
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([a, b]);
    expect((await router.generate(request, output)).provider).toBe("b");
    expect(a.calls).toHaveLength(1);
  });

  it("code fences around valid JSON are accepted", async () => {
    const a = fakeProvider("a", "```json\n" + OK + "\n```");
    const { router } = makeRouter([a]);
    expect((await router.generate(request, output)).value).toEqual({ ok: true });
  });

  it("a schema failure gets one repair call on the same provider, with the issues", async () => {
    const a = fakeProvider("a", '{"ok":false}', OK);
    const b = fakeProvider("b", OK);
    const { router, logs } = makeRouter([a, b]);
    const result = await router.generate(request, output);
    expect(result.provider).toBe("a");
    expect(a.calls).toHaveLength(2);
    expect(a.calls[1]?.user).toContain("did not match the required schema");
    expect(a.calls[1]?.user).toContain("- ok:");
    expect(logs.map((e) => (e.event === "llm_call" ? [e.repair, e.outcome] : []))).toEqual([
      [false, "bad_output"],
      [true, "ok"],
    ]);
  });

  it("a schema failure after the repair moves on; all providers unusable is ANALYSIS_FAILED", async () => {
    const a = fakeProvider("a", '{"ok":false}');
    const b = fakeProvider("b", "not json at all");
    const { router } = makeRouter([a, b]);
    await expectRouterError(router.generate(request, output), "ANALYSIS_FAILED");
    expect([a.calls.length, b.calls.length]).toEqual([2, 1]);
  });

  it("an auth error (bad key) falls back to the next provider and is not retried", async () => {
    const a = fakeProvider("a", new AuthError("a", 401));
    const b = fakeProvider("b", OK);
    const { router, logs } = makeRouter([a, b]);
    expect((await router.generate(request, output)).provider).toBe("b");
    expect(a.calls).toHaveLength(1);
    expect(logs[0]).toMatchObject({ provider: "a", outcome: "auth", httpStatus: 401 });
  });

  it("a request error (bad model ID) falls back to the next provider and is not retried", async () => {
    const a = fakeProvider("a", new RequestError("a", 404));
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([a, b]);
    expect((await router.generate(request, output)).provider).toBe("b");
    expect(a.calls).toHaveLength(1);
  });

  it("auth errors on every provider end at once with PROVIDER_UNAVAILABLE, no waiting", async () => {
    const a = fakeProvider("a", new AuthError("a", 401));
    const b = fakeProvider("b", new AuthError("b", 403));
    const { router } = makeRouter([a, b]);
    const started = Date.now();
    await expectRouterError(router.generate(request, output), "PROVIDER_UNAVAILABLE");
    expect(Date.now() - started).toBe(0);
    expect([a.calls.length, b.calls.length]).toEqual([1, 1]);
  });

  it("a broken key stops costing a call once its breaker opens", async () => {
    const a = fakeProvider("a", new AuthError("a", 401));
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([a, b]);
    for (let i = 0; i < 5; i += 1) await router.generate(request, output);
    expect(a.calls).toHaveLength(3);
    expect(router.breakerStates().a).toBe("open");
  });

  it("with no provider configured, fails with PROVIDER_UNAVAILABLE", async () => {
    const { router } = makeRouter([]);
    await expectRouterError(router.generate(request, output), "PROVIDER_UNAVAILABLE");
  });
});

describe("circuit breaker", () => {
  it("opens after 3 failures in a row and skips the provider for 60 s", async () => {
    const a = fakeProvider("a", new TransientError("a", "HTTP 500", 500));
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([a, b]);
    for (let i = 0; i < 3; i += 1) await router.generate(request, output);
    expect(a.calls).toHaveLength(3);
    expect(router.breakerStates().a).toBe("open");

    await router.generate(request, output);
    expect(a.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(59_999);
    await router.generate(request, output);
    expect(a.calls).toHaveLength(3);
  });

  it("a breaker that opens during a call ends that call instead of waiting 60 s (A177)", async () => {
    const a = fakeProvider("a", new TransientError("a", "HTTP 500", 500));
    const { router } = makeRouter([a]);
    let code: string | undefined;
    const pending = router.generate(request, output).catch((error: unknown) => {
      code = (error as { code?: string }).code;
    });
    // Fail, 2 s, fail, 4 s, fail: the third failure opens the breaker.
    await vi.advanceTimersByTimeAsync(6_500);
    await pending;
    expect(code).toBe("PROVIDER_UNAVAILABLE");
    expect(a.calls).toHaveLength(3);
    expect(router.breakerStates().a).toBe("open");
  });

  it("half-open after 60 s lets one trial through; success closes it", async () => {
    const fail = new TransientError("a", "HTTP 500", 500);
    const a = fakeProvider("a", fail, fail, fail, OK);
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([a, b]);
    for (let i = 0; i < 3; i += 1) await router.generate(request, output);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(router.breakerStates().a).toBe("half-open");
    expect((await router.generate(request, output)).provider).toBe("a");
    expect(router.breakerStates().a).toBe("closed");
  });

  it("a failed half-open trial opens it for another 60 s", async () => {
    const a = fakeProvider("a", new TransientError("a", "HTTP 500", 500));
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([a, b]);
    for (let i = 0; i < 3; i += 1) await router.generate(request, output);
    await vi.advanceTimersByTimeAsync(60_000);
    await router.generate(request, output);
    expect(a.calls).toHaveLength(4);
    expect(router.breakerStates().a).toBe("open");
    await router.generate(request, output);
    expect(a.calls).toHaveLength(4);
  });
});

describe("limits and budgets", () => {
  it("daily budget: once a provider's budget is spent, calls go to the next one", async () => {
    const a = fakeProvider("a", OK);
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([routed(a, { rpdBudget: 2 }), b]);
    const used = [];
    for (let i = 0; i < 3; i += 1) used.push((await router.generate(request, output)).provider);
    expect(used).toEqual(["a", "a", "b"]);
  });

  it("daily budget spent everywhere: RATE_LIMITED until midnight Pacific, then usable again", async () => {
    vi.setSystemTime(new Date("2026-11-02T20:00:00-08:00"));
    const a = fakeProvider("a", OK);
    const { router } = makeRouter([routed(a, { rpdBudget: 1 })]);
    await router.generate(request, output);
    const error = await expectRouterError(router.generate(request, output), "RATE_LIMITED");
    expect(error?.retryAfterSec).toBe(4 * 3600);
    expect(a.calls).toHaveLength(1);

    vi.setSystemTime(new Date("2026-11-03T00:00:01-08:00"));
    expect((await router.generate(request, output)).provider).toBe("a");
  });

  it("token bucket: a second call waits for a token instead of exceeding the rpm", async () => {
    const a = fakeProvider("a", OK);
    const { router } = makeRouter([routed(a, { rpm: 1 })]);
    await router.generate(request, output);
    const pending = settle(router.generate(request, output));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(a.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: true });
    expect(a.calls).toHaveLength(2);
  });

  it("never waits past ANALYSIS_BUDGET_MS: a Retry-After beyond it fails at once", async () => {
    const a = fakeProvider("a", new RateLimitError("a", 200_000));
    const { router } = makeRouter([a]);
    const started = Date.now();
    const error = await expectRouterError(router.generate(request, output), "RATE_LIMITED");
    expect(Date.now() - started).toBe(0);
    expect(error?.retryAfterSec).toBe(200);
  });

  it("the per-call timeout is capped by what is left of the budget", async () => {
    const a = fakeProvider("a", hangUntilAborted);
    const { router } = makeRouter([a], { budgetMs: 10_000 });
    const pending = expectRouterError(router.generate(request, output), "PROVIDER_UNAVAILABLE");
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(a.calls).toHaveLength(1);
  });

  it("an explicit deadline shared by several calls is honoured", async () => {
    const a = fakeProvider("a", answerAfter(3_000, OK));
    const { router } = makeRouter([a]);
    const deadline = Date.now() + 5_000;
    const first = settle(router.generate(request, output, { deadline }));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await first).toMatchObject({ ok: true });
    const second = expectRouterError(
      router.generate(request, output, { deadline }),
      "PROVIDER_UNAVAILABLE",
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await second;
  });
});

describe("a spent budget", () => {
  it("makes no provider request once the deadline has passed, and logs no call", async () => {
    const a = fakeProvider("a", answerAfter(10, OK));
    const { router, logs } = makeRouter([a]);
    await expectRouterError(
      router.generate(request, output, { deadline: Date.now() - 1 }),
      "PROVIDER_UNAVAILABLE",
    );
    expect(a.calls).toHaveLength(0);
    expect(logs.filter((l) => l.event === "llm_call")).toEqual([]);
  });

  it("when one provider uses up the budget, the next is not called with 0 ms left", async () => {
    const a = fakeProvider("a", hangUntilAborted);
    const b = fakeProvider("b", answerAfter(10, OK));
    const { router, logs } = makeRouter([a, b], { budgetMs: 1_000, timeoutMs: 5_000 });
    const pending = expectRouterError(router.generate(request, output), "PROVIDER_UNAVAILABLE");
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
    expect(logs.filter((l) => l.event === "llm_call").map((l) => l.provider)).toEqual(["a"]);
  });
});

describe("a provider output cap (A95)", () => {
  it("skips a provider capped below the request, without calling it or changing the error code", async () => {
    const a = fakeProvider("a", new AuthError("a", 401));
    const b = fakeProvider("b", OK);
    const { router, logs } = makeRouter([a, routed(b, { maxOutputTokens: 50 })]);
    expect(router.smallestOutputCap).toBe(50);
    await expectRouterError(router.generate(request, output), "PROVIDER_UNAVAILABLE");
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
    expect(logs.filter((l) => l.event === "llm_call").map((l) => l.provider)).toEqual(["a"]);
  });

  it("uses the capped provider for a request within its cap", async () => {
    const a = fakeProvider("a", new AuthError("a", 401));
    const b = fakeProvider("b", OK);
    const { router } = makeRouter([a, routed(b, { maxOutputTokens: 100 })]);
    const { value } = await router.generate(request, output);
    expect(value).toEqual({ ok: true });
    expect(b.calls).toHaveLength(1);
  });

  it("reports no cap when no provider has one", () => {
    const { router } = makeRouter([fakeProvider("a")]);
    expect(router.smallestOutputCap).toBeUndefined();
  });
});

describe("concurrency and abort", () => {
  it("10 parallel callers never run more than LLM_CONCURRENCY calls at once", async () => {
    const a = fakeProvider("a", answerAfter(1_000, OK));
    const { router } = makeRouter([a], { concurrency: 2 });
    const pending = Array.from({ length: 10 }, () => settle(router.generate(request, output)));
    await vi.advanceTimersByTimeAsync(5_000);
    const results = await Promise.all(pending);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(a.calls).toHaveLength(10);
    expect(a.peakInFlight).toBe(2);
  });

  it("abort mid-call rejects with AbortError, tries no other provider and counts no failure", async () => {
    const a = fakeProvider("a", hangUntilAborted);
    const b = fakeProvider("b", OK);
    const { router, logs } = makeRouter([a, b]);
    const controller = new AbortController();
    const pending = settle(router.generate(request, output, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: Error }).error.name).toBe("AbortError");
    expect(a.calls[0]?.signal?.aborted).toBe(true);
    expect(b.calls).toHaveLength(0);
    expect(router.breakerStates().a).toBe("closed");
    expect(logs[0]).toMatchObject({ outcome: "aborted" });
  });

  it("abort while queued leaves the queue without calling the provider", async () => {
    const a = fakeProvider("a", answerAfter(10_000, OK));
    const { router } = makeRouter([a], { concurrency: 1 });
    const first = settle(router.generate(request, output));
    const controller = new AbortController();
    const second = settle(router.generate(request, output, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect((await second).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await first).ok).toBe(true);
    expect(a.calls).toHaveLength(1);
  });

  it("abort during a backoff wait stops at once", async () => {
    const a = fakeProvider("a", new RateLimitError("a"), OK);
    const { router } = makeRouter([a]);
    const controller = new AbortController();
    const pending = settle(router.generate(request, output, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(a.calls).toHaveLength(1);
  });
});
