import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  ConcurrencyQueue,
  DailyCounter,
  TokenBucket,
  type Clock,
} from "./limiter.js";

/** A clock the test moves by hand. sleep is not used by these classes. */
function manualClock(start: number) {
  let now = start;
  const clock: Clock = {
    now: () => now,
    sleep: () => Promise.resolve(),
  };
  return {
    clock,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A promise the test resolves by hand (Promise.withResolvers is ES2024). */
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: () => {
      resolve();
    },
  };
}

describe("TokenBucket", () => {
  it("starts full, then refills continuously at rpm per minute", () => {
    const { clock, advance } = manualClock(0);
    const bucket = new TokenBucket(6, clock);
    for (let i = 0; i < 6; i += 1) expect(bucket.tryTake()).toBe(0);
    expect(bucket.tryTake()).toBe(10_000);
    advance(9_999);
    expect(bucket.waitMs()).toBe(1);
    advance(1);
    expect(bucket.tryTake()).toBe(0);
  });

  it("never holds more than rpm tokens", () => {
    const { clock, advance } = manualClock(0);
    const bucket = new TokenBucket(2, clock);
    advance(10 * 60_000);
    expect([bucket.tryTake(), bucket.tryTake()]).toEqual([0, 0]);
    expect(bucket.tryTake()).toBeGreaterThan(0);
  });
});

describe("DailyCounter", () => {
  it("stops at the budget and resets at midnight Pacific", () => {
    const { clock, advance } = manualClock(Date.parse("2026-11-02T23:59:00-08:00"));
    const daily = new DailyCounter(2, clock);
    expect([daily.tryConsume(), daily.tryConsume(), daily.tryConsume()]).toEqual([
      true,
      true,
      false,
    ]);
    expect(daily.remaining()).toBe(0);
    expect(daily.msUntilReset()).toBe(60_000);
    advance(60_000);
    expect(daily.remaining()).toBe(2);
    expect(daily.tryConsume()).toBe(true);
  });

  it("uses Pacific time, not UTC: 07:59 UTC is still the previous Pacific day", () => {
    const { clock, advance } = manualClock(Date.parse("2026-11-03T07:59:00Z"));
    const daily = new DailyCounter(1, clock);
    daily.tryConsume();
    advance(60_000);
    expect(daily.remaining()).toBe(1);
  });
});

describe("ConcurrencyQueue", () => {
  it("runs at most `limit` tasks at once, first in first out", async () => {
    const queue = new ConcurrencyQueue(2);
    const order: number[] = [];
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const runs = gates.map((gate, index) =>
      queue.run(async () => {
        order.push(index);
        peak = Math.max(peak, queue.running);
        await gate.promise;
      }),
    );
    await Promise.resolve();
    expect(order).toEqual([0, 1]);
    expect(queue.queued).toBe(3);
    for (const gate of gates) {
      gate.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all(runs);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(queue.running).toBe(0);
  });

  it("an aborted waiter leaves the queue and never runs", async () => {
    const queue = new ConcurrencyQueue(1);
    const gate = deferred();
    const first = queue.run(() => gate.promise);
    const controller = new AbortController();
    let ran = false;
    const second = queue.run(() => {
      ran = true;
      return Promise.resolve();
    }, controller.signal);
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(queue.queued).toBe(0);
    gate.resolve();
    await first;
    expect(ran).toBe(false);
  });
});

describe("CircuitBreaker", () => {
  it("closed, open after 3 failures, half-open after 60 s, closed after a good trial", () => {
    const { clock, advance } = manualClock(0);
    const breaker = new CircuitBreaker(clock);
    breaker.failure();
    breaker.failure();
    expect(breaker.state()).toBe("closed");
    breaker.failure();
    expect(breaker.state()).toBe("open");
    expect(breaker.waitMs()).toBe(60_000);
    advance(60_000);
    expect(breaker.state()).toBe("half-open");
    expect(breaker.waitMs()).toBe(0);
    breaker.begin();
    expect(breaker.waitMs()).toBeGreaterThan(0);
    breaker.success();
    expect(breaker.state()).toBe("closed");
  });

  it("a success in between resets the count", () => {
    const { clock } = manualClock(0);
    const breaker = new CircuitBreaker(clock);
    breaker.failure();
    breaker.failure();
    breaker.success();
    breaker.failure();
    breaker.failure();
    expect(breaker.state()).toBe("closed");
  });

  it("a failed half-open trial reopens for a full pause; a cancelled one frees the trial", () => {
    const { clock, advance } = manualClock(0);
    const breaker = new CircuitBreaker(clock);
    for (let i = 0; i < 3; i += 1) breaker.failure();
    advance(60_000);
    breaker.begin();
    breaker.cancel();
    expect(breaker.waitMs()).toBe(0);
    breaker.begin();
    breaker.failure();
    expect(breaker.state()).toBe("open");
    expect(breaker.waitMs()).toBe(60_000);
  });
});
