import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zodOutput } from "./json.js";
import { AuthError, RateLimitError } from "./provider.js";
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

describe("a provider output cap", () => {
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
