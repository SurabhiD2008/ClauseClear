/** How long after a control disappears its double-click may still be arriving. */
export const FOLLOW_UP_CLICK_MS = 600;

/**
 * Call when a click makes its own control disappear (a dialog's submit closes
 * the dialog). The second click of a double-click then lands on whatever was
 * underneath: on the landing page, a sample link, which would replace the run
 * just started (prompt 18, audit item 10). This swallows the rest of that click
 * sequence (event.detail > 1) for a moment, in the capture phase, so nothing
 * underneath sees it. A fresh single click (detail 1) still works at once.
 */
export function swallowFollowUpClicks(
  target: Pick<Document, "addEventListener" | "removeEventListener"> = document,
  ms = FOLLOW_UP_CLICK_MS,
): () => void {
  const block = (event: Event) => {
    // A click's detail is its click count (MouseEvent.detail).
    const count = (event as { detail?: unknown }).detail;
    if (typeof count === "number" && count > 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  target.addEventListener("click", block, { capture: true });
  const stop = () => {
    clearTimeout(timer);
    target.removeEventListener("click", block, { capture: true });
  };
  const timer = setTimeout(stop, ms);
  return stop;
}

/**
 * The second click of a double-click (MouseEvent.detail above 1). A link that
 * starts work in its onClick ignores it, so a double-click opens one page,
 * pushes one history entry and fetches once (prompt 19, A178).
 */
export function isFollowUpClick(event: { detail: number }): boolean {
  return event.detail > 1;
}

/**
 * Says whether FOLLOW_UP_CLICK_MS has passed since `arm()`. For a
 * control that takes focus when it appears: Cancel gets focus as a run starts,
 * so the second press of a doubled Space or Enter on "Check this text" landed
 * on it and cancelled the run just started (prompt 19, A178).
 */
export function settleGuard(now: () => number = () => performance.now(), ms = FOLLOW_UP_CLICK_MS) {
  let readyAt = 0;
  return {
    arm: () => {
      readyAt = now() + ms;
    },
    ready: () => now() >= readyAt,
  };
}
