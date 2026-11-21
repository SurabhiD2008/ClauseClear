// The checks that run inside the page at the end of a test, in one evaluate.
/** The page-side checks, run in one evaluate. Kept free of closures over Node values. */
export function pageChecks(input: {
  phone: boolean;
  keys: string[];
  userText: string;
  minTarget: number;
}) {
  const found: { check: string; detail: string }[] = [];
  const add = (check: string, detail: string) => found.push({ check, detail });
  const describe = (el: Element) => {
    const id = el.id === "" ? "" : `#${el.id}`;
    const cls =
      typeof el.className === "string" && el.className.trim() !== ""
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
    const text = el.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
    return `<${el.tagName.toLowerCase()}${id}${cls}>${text === "" ? "" : ` "${text}"`}`;
  };
  const shown = (el: Element) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    // 1 px boxes are the visually-hidden pattern for screen-reader text. The
    // layout size is used, since a transformed parent (the sheet) scales the rect.
    if (el instanceof HTMLElement) return el.offsetWidth > 1 && el.offsetHeight > 1;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const all = [...document.body.querySelectorAll("*")];
  const vw = document.documentElement.clientWidth;

  // Overflow: the page scrolls sideways, or an element is wider than the viewport.
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) {
    add(
      "overflow",
      `page scrollWidth ${String(doc.scrollWidth)} > clientWidth ${String(doc.clientWidth)}`,
    );
  }
  for (const el of all) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > vw + 0.5)
      add(
        "overflow",
        `${describe(el)} is ${String(Math.round(r.width))} px wide; viewport ${String(vw)}`,
      );
  }

  // Clipping: a box with hidden overflow that cuts off its own text.
  for (const el of all) {
    if (!(el instanceof HTMLElement) || !shown(el)) continue;
    const s = getComputedStyle(el);
    const hidesX = s.overflowX === "hidden" || s.overflowX === "clip";
    const hidesY = s.overflowY === "hidden" || s.overflowY === "clip";
    if (!hidesX && !hidesY) continue;
    const ownText = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (!ownText) continue;
    const overX = hidesX && el.scrollWidth > el.clientWidth + 1;
    const overY = hidesY && el.scrollHeight > el.clientHeight + 1;
    if (overX || overY) {
      add(
        "clipping",
        `${describe(el)} content ${String(el.scrollWidth)}x${String(el.scrollHeight)} in a ${String(el.clientWidth)}x${String(el.clientHeight)} box`,
      );
    }
  }

  // Targets: on a phone, everything you can tap is at least 44 x 44.
  const interactive =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [tabindex]:not([tabindex="-1"])';
  if (input.phone) {
    for (const el of document.querySelectorAll(interactive)) {
      if (el.closest("[inert]") !== null) continue;
      const boxes = [el.getBoundingClientRect()];
      // A field's label is part of its target.
      if (el instanceof HTMLInputElement) {
        for (const label of el.labels ?? []) boxes.push(label.getBoundingClientRect());
      }
      if (!shown(el) && !(el instanceof HTMLInputElement && boxes.length > 1)) continue;
      const w = Math.max(...boxes.map((b) => b.width));
      const h = Math.max(...boxes.map((b) => b.height));
      if (w === 0 || h === 0) continue;
      if (w < input.minTarget - 0.01 || h < input.minTarget - 0.01) {
        add("targets", `${describe(el)} is ${w.toFixed(1)}x${h.toFixed(1)} px`);
      }
    }
  }

  // Semantics: images without alt, duplicate ids, controls without a name.
  for (const img of document.querySelectorAll("img:not([alt])"))
    add("semantics", `${describe(img)} has no alt`);
  const ids = new Map<string, number>();
  for (const el of document.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) add("semantics", `id "${id}" is used ${String(n)} times`);
  const nameOf = (el: Element) => {
    const label = el.getAttribute("aria-label")?.trim();
    if (label) return label;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      if (text !== "") return text;
    }
    const alts = [...el.querySelectorAll("img[alt]")]
      .map((i) => i.getAttribute("alt") ?? "")
      .join(" ");
    const text = `${el.textContent} ${alts}`.trim();
    if (text !== "") return text;
    return el.getAttribute("title")?.trim() ?? "";
  };
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="link"]')) {
    if (nameOf(el) === "") add("semantics", `${describe(el)} has no accessible name`);
  }

  // Language.
  const english = document.documentElement.lang !== "hi";
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const devanagari = /[ऀ-ॿ]/;
  // Devanagari letters and signs, not the danda (।, ॥): "ClauseClear।" is correct Hindi punctuation.
  const mixed = /[A-Za-z][ऀ-ॣ०-ॿ]|[ऀ-ॣ०-ॿ][A-Za-z]/;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = node.textContent ?? "";
    if (parent === null || text.trim() === "" || !shown(parent)) continue;
    if (parent.closest("script, style, noscript") !== null) continue;
    if (parent.closest(input.userText) !== null) continue;
    const snippet = text.trim().slice(0, 50);
    if (english && devanagari.test(text))
      add("language", `Devanagari in English mode: ${describe(parent)} "${snippet}"`);
    if (mixed.test(text)) add("language", `mixed script in one word: "${snippet}"`);
    if (/\{\w+\}/.test(text)) add("language", `unfilled placeholder: "${snippet}"`);
  }
  const visibleText = document.body.innerText;
  for (const key of input.keys) {
    if (new RegExp(`(^|[^\\w.])${key.replace(/\./g, "\\.")}($|[^\\w.])`).test(visibleText)) {
      add("language", `untranslated key on screen: ${key}`);
    }
  }

  // Motion: under reduced motion nothing animates and nothing scrolls smoothly.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const animation of document.getAnimations()) {
      if (animation.playState !== "running") continue;
      const timing = animation.effect?.getComputedTiming();
      if (timing === undefined || Number(timing.duration ?? 0) <= 0) continue;
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      const name =
        animation instanceof CSSAnimation
          ? animation.animationName
          : animation instanceof CSSTransition
            ? `transition of ${animation.transitionProperty}`
            : "script animation";
      add("motion", `${name} running on ${target === null ? "?" : describe(target)}`);
    }
    for (const el of [document.documentElement, document.body, ...all]) {
      if (getComputedStyle(el).scrollBehavior === "smooth") {
        add(
          "motion",
          `scroll-behavior: smooth on ${el === document.documentElement ? "<html>" : describe(el)}`,
        );
      }
    }
  }
  return found;
}
