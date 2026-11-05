// Rate and concurrency controls from SPEC section 5 rules 3 to 5. Every piece
// takes a Clock so tests can drive time; the default clock is Date.now and
// setTimeout, which Vitest's fake timers also control.
import {
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_FAILURES,
  DAILY_QUOTA_TIME_ZONE,
} from "@clauseclear/shared";

export interface Clock {
  now(): number;
  /** Resolves after ms, or rejects with the signal's reason when it aborts first. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason as Error);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason as Error);
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        Math.max(0, ms),
      );
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

/** Requests per minute, refilled continuously. Starts full. */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;
  private readonly perMs: number;

  constructor(
    private readonly rpm: number,
    private readonly clock: Clock,
  ) {
    this.tokens = rpm;
    this.updatedAt = clock.now();
    this.perMs = rpm / 60_000;
  }

  private refill(): void {
    const now = this.clock.now();
    this.tokens = Math.min(this.rpm, this.tokens + (now - this.updatedAt) * this.perMs);
    this.updatedAt = now;
  }

  /** Takes a token and returns 0, or returns the ms until one is free without taking it. */
  tryTake(): number {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - this.tokens) / this.perMs);
  }

  /** Ms until a token is free (0 if one is free now). Takes nothing. */
  waitMs(): number {
    this.refill();
    return this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.perMs);
  }
}

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAILY_QUOTA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(ms: number): { day: string; secondsIntoDay: number } {
  const parts = Object.fromEntries(dayFormat.formatToParts(ms).map((p) => [p.type, p.value]));
  const day = `${parts.year ?? ""}-${parts.month ?? ""}-${parts.day ?? ""}`;
  const secondsIntoDay =
    Number(parts.hour ?? 0) * 3600 + Number(parts.minute ?? 0) * 60 + Number(parts.second ?? 0);
  return { day, secondsIntoDay };
}

/** Requests sent per provider per day, reset at midnight in DAILY_QUOTA_TIME_ZONE. */
export class DailyCounter {
  private day: string;
  private used = 0;

  constructor(
    readonly budget: number,
    private readonly clock: Clock,
  ) {
    this.day = zonedParts(clock.now()).day;
  }

  private roll(): void {
    const { day } = zonedParts(this.clock.now());
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
  }

  remaining(): number {
    this.roll();
    return Math.max(0, this.budget - this.used);
  }

  /** Counts one request if the budget allows it. */
  tryConsume(): boolean {
    this.roll();
    if (this.used >= this.budget) return false;
    this.used += 1;
    return true;
  }

  /** Ms until the next midnight in the quota time zone (approximate across DST changes). */
  msUntilReset(): number {
    const { secondsIntoDay } = zonedParts(this.clock.now());
    return Math.max(1000, (86_400 - secondsIntoDay) * 1000);
  }
}

/** FIFO queue that lets at most `limit` tasks run at once across the server. */
export class ConcurrencyQueue {
  private active = 0;
  private readonly waiting: { start: () => void; cancel: (reason: unknown) => void }[] = [];

  constructor(readonly limit: number) {}

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(signal.reason as Error);
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        start: () => {
          signal?.removeEventListener("abort", onAbort);
          this.active += 1;
          resolve();
        },
        cancel: reject,
      };
      // An aborted caller leaves the queue at once and never takes a slot.
      const onAbort = () => {
        const index = this.waiting.indexOf(entry);
        if (index !== -1) this.waiting.splice(index, 1);
        entry.cancel(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.start();
  }
}

export type BreakerState = "closed" | "open" | "half-open";

/**
 * Pauses a provider for CIRCUIT_BREAKER_COOLDOWN_MS after CIRCUIT_BREAKER_FAILURES
 * failures in a row. After the pause one trial call is let through (half-open):
 * success closes the breaker, failure opens it for another full pause.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | undefined;
  private trialInFlight = false;

  constructor(
    private readonly clock: Clock,
    private readonly threshold = CIRCUIT_BREAKER_FAILURES,
    private readonly cooldownMs = CIRCUIT_BREAKER_COOLDOWN_MS,
  ) {}

  state(): BreakerState {
    if (this.openedAt === undefined) return "closed";
    return this.clock.now() - this.openedAt >= this.cooldownMs ? "half-open" : "open";
  }

  /** Ms until a call may be tried (0 if allowed now). */
  waitMs(): number {
    const state = this.state();
    if (state === "closed") return 0;
    if (state === "half-open") return this.trialInFlight ? this.cooldownMs : 0;
    return (this.openedAt ?? 0) + this.cooldownMs - this.clock.now();
  }

  /** Call just before sending. In half-open state this claims the single trial. */
  begin(): void {
    if (this.state() === "half-open") this.trialInFlight = true;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = undefined;
    this.trialInFlight = false;
  }

  failure(): void {
    this.trialInFlight = false;
    this.failures += 1;
    if (this.state() === "half-open" || this.failures >= this.threshold) {
      this.openedAt = this.clock.now();
    }
  }

  /** An aborted call says nothing about the provider; free the trial without counting. */
  cancel(): void {
    this.trialInFlight = false;
  }
}
