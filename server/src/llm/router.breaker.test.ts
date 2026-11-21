import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zodOutput } from "./json.js";
import { TransientError } from "./provider.js";
import { LlmRouter, type LlmLogEntry, type RoutedProvider, type RouterOptions } from "./router.js";
import { fakeProvider, type FakeProvider } from "./testing/fakeProvider.js";

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T12:00:00-08:00"));
});

afterEach(() => {
  vi.useRealTimers();
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

  it("a breaker that opens during a call ends that call instead of waiting 60 s", async () => {
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
