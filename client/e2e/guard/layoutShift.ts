// The layout-shift recorder injected into every page before it loads.
/**
 * CLS as Chrome defines it: the largest session window of layout shifts. The
 * window's biggest shifts are reported with the elements that moved,
 * so a failure names its cause and not only a number.
 */
export function clsScript() {
  let windowValue = 0;
  let windowStart = 0;
  let last = 0;
  let max = 0;
  let windowShifts: { value: number; at: number; what: string }[] = [];
  const name = (node: Node | null) => {
    if (!(node instanceof Element)) return node === null ? "?" : node.nodeName;
    const first = typeof node.className === "string" ? node.className.trim().split(/\s+/)[0] : "";
    return first === undefined || first === "" ? node.tagName : `${node.tagName}.${first}`;
  };
  const box = (r: DOMRectReadOnly) =>
    `y${String(Math.round(r.y))} h${String(Math.round(r.height))}`;
  // Exemption: the moment a language the user
  // asked for is applied counts as input, like Chrome's 500 ms after a click.
  // Hindi strings and fonts load only after the toggle, so the
  // swap can land later than 500 ms after the click itself. Only a change of
  // <html lang> that follows a click or key press counts; a saved choice applied
  // at page load is not exempt.
  let lastInput = -Infinity;
  // The window runs from the change until 500 ms after the first frame drawn
  // after it, so a slow frame under load does not push the swap out of it.
  let langFrom = Infinity;
  let langUntil = -Infinity;
  for (const type of ["pointerdown", "keydown"]) {
    addEventListener(
      type,
      () => {
        lastInput = performance.now();
      },
      { capture: true },
    );
  }
  new MutationObserver((records) => {
    for (const record of records) {
      const root = record.target as Element;
      if (root !== document.documentElement) continue;
      if (record.oldValue === root.getAttribute("lang")) continue;
      if (performance.now() - lastInput >= 10_000) continue;
      langFrom = performance.now();
      langUntil = Infinity;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          langUntil = performance.now() + 500;
        });
      });
    }
  }).observe(document, {
    attributes: true,
    attributeFilter: ["lang"],
    attributeOldValue: true,
    subtree: true,
  });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources?: {
        node: Node | null;
        previousRect: DOMRectReadOnly;
        currentRect: DOMRectReadOnly;
      }[];
    })[]) {
      if (entry.hadRecentInput) continue;
      if (entry.startTime >= langFrom && entry.startTime < langUntil) continue;
      if (entry.startTime - last > 1000 || entry.startTime - windowStart > 5000) {
        windowValue = 0;
        windowStart = entry.startTime;
        windowShifts = [];
      }
      windowValue += entry.value;
      windowShifts.push({
        value: entry.value,
        at: Math.round(entry.startTime),
        what: (entry.sources ?? [])
          .slice(0, 3)
          .map((x) => `${name(x.node)} ${box(x.previousRect)} -> ${box(x.currentRect)}`)
          .join(", "),
      });
      last = entry.startTime;
      if (windowValue > max) {
        max = windowValue;
        const worst = [...windowShifts]
          .sort((a, b) => b.value - a.value)
          .slice(0, 3)
          .map((x) => `${x.value.toFixed(3)} at ${String(x.at)} ms: ${x.what}`)
          .join("; ");
        (
          window as unknown as {
            __ccGuardCls?: (v: number, url: string, sources: string) => void;
          }
        ).__ccGuardCls?.(max, location.pathname, worst);
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
}
