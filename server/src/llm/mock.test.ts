import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zodOutput } from "./json.js";
import {
  MOCK_RETRY_AFTER_MS,
  MOCK_SCENARIOS,
  createMockProvider,
  runWithMockScenario,
  scenarioFromHeader,
  type MockScenario,
} from "./mock.js";
import { BadOutputError, RateLimitError, TransientError } from "./provider.js";
import { LlmRouter, LlmRouterError } from "./router.js";

const request = { system: "s", user: "u", schemaName: "analysis", maxOutputTokens: 100 };
const anyJson = zodOutput(z.looseObject({}));

function router(scenario: MockScenario, timeoutMs = 45_000) {
  return new LlmRouter({
    providers: [
      { provider: createMockProvider({ scenario, slowMs: 5_000 }), rpm: 600, rpdBudget: 1_000 },
    ],
    concurrency: 2,
    timeoutMs,
    budgetMs: 100_000,
    random: () => 0.5,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("mock provider scenarios (SPEC section 12)", () => {
  it("normal replays the fixture as JSON", async () => {
    const result = await createMockProvider({ scenario: "normal" }).generateJson(request);
    const parsed = JSON.parse(result.text) as { flags: unknown[]; docType: string };
    expect(parsed.docType).toBe("rental");
    expect(parsed.flags.length).toBeGreaterThan(0);
  });

  it("rate_limit and rate_limit_no_retry_after throw 429s with and without Retry-After", async () => {
    const withHeader = await createMockProvider({ scenario: "rate_limit" })
      .generateJson(request)
      .catch((error: unknown) => error);
    expect(withHeader).toBeInstanceOf(RateLimitError);
    expect((withHeader as RateLimitError).retryAfterMs).toBe(MOCK_RETRY_AFTER_MS);
    const without = await createMockProvider({ scenario: "rate_limit_no_retry_after" })
      .generateJson(request)
      .catch((error: unknown) => error);
    expect((without as RateLimitError).retryAfterMs).toBeUndefined();
  });

  it("server_error is a 500", async () => {
    const error = await createMockProvider({ scenario: "server_error" })
      .generateJson(request)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransientError);
    expect((error as TransientError).httpStatus).toBe(500);
  });

  it("timeout never answers, so the router's timeout ends it", async () => {
    const pending = router("timeout", 1_000)
      .generate(request, anyJson, { deadline: Date.now() + 1_500 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(((await pending) as LlmRouterError).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("malformed_json and truncated_json do not parse", async () => {
    for (const scenario of ["malformed_json", "truncated_json"] as const) {
      const { text } = await createMockProvider({ scenario }).generateJson(request);
      expect(() => JSON.parse(text) as unknown).toThrow();
      expect(() => anyJson.parse("mock", text)).toThrow(BadOutputError);
    }
  });

  it("hallucinated_quotes replaces every present quote; half_wrong_quotes about half", async () => {
    const quotes = async (scenario: MockScenario) => {
      const { text } = await createMockProvider({ scenario }).generateJson(request);
      const flags = (JSON.parse(text) as { flags: { kind: string; quote?: string }[] }).flags;
      return flags.filter((f) => f.kind === "present").map((f) => f.quote ?? "");
    };
    const normal = await quotes("normal");
    const all = await quotes("hallucinated_quotes");
    const half = await quotes("half_wrong_quotes");
    expect(all.every((quote, i) => quote !== normal[i])).toBe(true);
    const changed = half.filter((quote, i) => quote !== normal[i]).length;
    expect(changed).toBe(Math.ceil(normal.length / 2));
  });

  it("empty_result, oversized_result and not_legal are valid JSON with those shapes", async () => {
    const parse = async (scenario: MockScenario) =>
      JSON.parse((await createMockProvider({ scenario }).generateJson(request)).text) as Record<
        string,
        unknown
      >;
    expect((await parse("empty_result")).flags).toEqual([]);
    expect(String((await parse("oversized_result")).summary).length).toBeGreaterThan(
      request.maxOutputTokens * 4,
    );
    expect(await parse("not_legal")).toEqual({ notLegal: true });
  });

  it("slow answers after MOCK_SLOW_MS and can be cancelled before that", async () => {
    const provider = createMockProvider({ scenario: "slow", slowMs: 5_000 });
    const answered = provider.generateJson(request);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await answered).text).toContain("rental");

    const controller = new AbortController();
    const cancelled = provider
      .generateJson({ ...request, signal: controller.signal })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(((await cancelled) as Error).name).toBe("AbortError");
  });

  it("every listed scenario is handled", async () => {
    for (const scenario of MOCK_SCENARIOS) {
      const outcome = createMockProvider({ scenario, slowMs: 1 })
        .generateJson({ ...request, signal: AbortSignal.timeout(10) })
        .then(
          () => "answered",
          () => "threw",
        );
      await vi.advanceTimersByTimeAsync(20);
      expect(["answered", "threw"]).toContain(await outcome);
    }
  });
});

describe("scenario selection", () => {
  it("the x-mock-scenario header counts only when NODE_ENV is test", () => {
    expect(scenarioFromHeader("server_error", "test")).toBe("server_error");
    expect(scenarioFromHeader(["rate_limit", "normal"], "test")).toBe("rate_limit");
    expect(scenarioFromHeader("server_error", "production")).toBeUndefined();
    expect(scenarioFromHeader("server_error", "development")).toBeUndefined();
    expect(scenarioFromHeader("server_error", undefined)).toBeUndefined();
    expect(scenarioFromHeader("drop_tables", "test")).toBeUndefined();
  });

  it("a per-request scenario overrides MOCK_SCENARIO for that request only", async () => {
    const provider = createMockProvider({ scenario: "normal" });
    const overridden = await runWithMockScenario("not_legal", () => provider.generateJson(request));
    expect(JSON.parse(overridden.text)).toEqual({ notLegal: true });
    const plain = await provider.generateJson(request);
    expect(JSON.parse(plain.text)).toHaveProperty("flags");
  });

  it("the router honours the per-request scenario (rate_limit then RATE_LIMITED)", async () => {
    const pending = runWithMockScenario("rate_limit", () =>
      router("normal")
        .generate(request, anyJson)
        .catch((error: unknown) => error),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const error = (await pending) as LlmRouterError;
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSec).toBe(MOCK_RETRY_AFTER_MS / 1000);
  });
});
