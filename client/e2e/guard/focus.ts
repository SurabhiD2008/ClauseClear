// The focus walk: Tab through the page and report hidden, invisible or trapped focus.
import type { Page } from "@playwright/test";
import type { Violation } from "./types.js";

/** At most this many Tab presses in the focus walk. */
const MAX_TABS = 60;

/** Where focus is after a Tab, and whether it can be seen. */
function focusState() {
  const el = document.activeElement;
  if (el === null || el === document.body || el === document.documentElement) return null;
  const path: string[] = [];
  for (
    let node: Element | null = el;
    node !== null && node !== document.body;
    node = node.parentElement
  ) {
    const parent: Element | null = node.parentElement;
    path.unshift(
      `${node.tagName}:${String(parent === null ? 0 : [...parent.children].indexOf(node))}`,
    );
  }
  const r = el.getBoundingClientRect();
  // Not "off screen": the app scrolls smoothly, so a newly focused element may
  // still be on its way into view when this runs.
  const visible =
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    r.width > 1 &&
    r.height > 1;
  const ringOf = (s: CSSStyleDeclaration) =>
    (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
    (s.boxShadow !== "none" && s.boxShadow !== "");
  const ring =
    ringOf(getComputedStyle(el)) ||
    ringOf(getComputedStyle(el, "::after")) ||
    ringOf(getComputedStyle(el, "::before"));
  const text = (el.getAttribute("aria-label") ?? el.textContent)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
  return {
    key: path.join("/"),
    label: `<${el.tagName.toLowerCase()}>${text === "" ? "" : ` "${text}"`}`,
    visible,
    ring,
    modal: document.querySelector('dialog:modal, [aria-modal="true"]') !== null,
  };
}

export async function focusWalk(page: Page): Promise<Violation[]> {
  const found: Violation[] = [];
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const seen = new Set<string>();
  let previous: string | null = null;
  let first: string | null = null;
  for (let i = 0; i < MAX_TABS; i += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(focusState);
    if (state === null) {
      // Focus left the page: the end of the tab order, which is not a trap.
      if (seen.size > 0) break;
      continue;
    }
    if (state.key === previous) {
      if (!state.modal)
        found.push({ check: "focus", detail: `keyboard trap: Tab stays on ${state.label}` });
      break;
    }
    if (state.key === first && !state.modal) {
      // Wrapped round without leaving the page: fine only inside a modal dialog.
      found.push({
        check: "focus",
        detail: `keyboard trap: Tab cycles back to ${state.label} without leaving`,
      });
      break;
    }
    if (state.key === first) break;
    first ??= state.key;
    previous = state.key;
    if (seen.has(state.key)) continue;
    seen.add(state.key);
    if (!state.visible)
      found.push({ check: "focus", detail: `Tab lands on a hidden element: ${state.label}` });
    else if (!state.ring)
      found.push({ check: "focus", detail: `no visible focus ring on ${state.label}` });
  }
  return found;
}
