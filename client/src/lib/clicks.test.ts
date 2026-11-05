import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_UP_CLICK_MS, isFollowUpClick, settleGuard, swallowFollowUpClicks } from "./clicks";

/** A click with the given click count, dispatched at the inner target, as a browser would. */
function click(at: EventTarget, detail: number) {
  const event = new Event("click", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "detail", { value: detail });
  at.dispatchEvent(event);
  return event;
}

describe("swallowFollowUpClicks (prompt 18, item 10)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the second click of a double-click before anything sees it", () => {
    const doc = new EventTarget();
    const seen: number[] = [];
    swallowFollowUpClicks(doc);
    // Plays the sample link under the dialog. Node's EventTarget has no tree, so
    // listeners run in the order added; added after, it runs after the capture
    // listener, as a descendant's listener does on a real page.
    doc.addEventListener("click", (e) => seen.push((e as unknown as { detail: number }).detail));
    const second = click(doc, 2);
    expect(second.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);
  });

  it("lets a fresh single click through at once", () => {
    const doc = new EventTarget();
    const seen: number[] = [];
    doc.addEventListener("click", (e) => seen.push((e as unknown as { detail: number }).detail));
    swallowFollowUpClicks(doc);
    expect(click(doc, 1).defaultPrevented).toBe(false);
    expect(seen).toEqual([1]);
  });

  it("removes itself after the window, so later double-clicks work", () => {
    vi.useFakeTimers();
    const doc = new EventTarget();
    const seen: number[] = [];
    doc.addEventListener("click", (e) => seen.push((e as unknown as { detail: number }).detail));
    swallowFollowUpClicks(doc);
    vi.advanceTimersByTime(FOLLOW_UP_CLICK_MS);
    expect(click(doc, 2).defaultPrevented).toBe(false);
    expect(seen).toEqual([2]);
  });

  it("the returned stop removes it early", () => {
    const doc = new EventTarget();
    const stop = swallowFollowUpClicks(doc);
    stop();
    expect(click(doc, 2).defaultPrevented).toBe(false);
  });
});

describe("isFollowUpClick and settleGuard (prompt 19, A178)", () => {
  it("only the second and later clicks of a sequence are follow-ups", () => {
    expect(isFollowUpClick({ detail: 0 })).toBe(false);
    expect(isFollowUpClick({ detail: 1 })).toBe(false);
    expect(isFollowUpClick({ detail: 2 })).toBe(true);
  });

  it("is not ready until FOLLOW_UP_CLICK_MS after arm, and ready before any arm", () => {
    let now = 1_000;
    const guard = settleGuard(() => now);
    expect(guard.ready()).toBe(true);
    guard.arm();
    expect(guard.ready()).toBe(false);
    now += FOLLOW_UP_CLICK_MS - 1;
    expect(guard.ready()).toBe(false);
    now += 1;
    expect(guard.ready()).toBe(true);
  });
});
