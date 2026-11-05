import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

// The oddity guard (SPEC section 12): an auto fixture on every end-to-end test.
// While the test runs it records console messages, page errors and network
// traffic; when the test ends it checks the final page for overflow, clipping,
// small tap targets, semantics, axe, layout shift, language, focus and motion.
// Any finding fails the test, with a screenshot in audit/screens/guard/.
//
// Specs import { test, expect } from "./guard" instead of "@playwright/test".
// A test that causes an HTTP error on purpose says so with guard.expectStatus.
// Every exemption below is explained in AUDIT.md ("Guard exemptions").

export const GUARD_CHECKS = [
  "console",
  "runtime",
  "network",
  "overflow",
  "clipping",
  "targets",
  "semantics",
  "axe",
  "layout-shift",
  "language",
  "focus",
  "motion",
] as const;
export type GuardCheck = (typeof GUARD_CHECKS)[number];

export interface Violation {
  check: GuardCheck;
  detail: string;
}

export interface Guard {
  /** A response with this status (any 400+ if omitted) for a matching URL is part of the test. */
  expectStatus(url: RegExp, status?: number): void;
  /** Runs every check now and returns the findings without failing (self-tests). */
  collect(): Promise<Violation[]>;
  /** Forgets everything recorded so far (self-tests, after collect). */
  reset(): void;
}

const ROOT = process.cwd();
/** CLS above this fails (SPEC section 12). */
export const CLS_LIMIT = 0.1;
/** Smallest tap target on a phone project, in CSS pixels. */
export const MIN_TARGET = 44;
/** At most this many Tab presses in the focus walk. */
const MAX_TABS = 60;

/** Every interface key, so a key shown instead of its text can be spotted. */
function flatKeys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) =>
    flatKeys(v, prefix === "" ? k : `${prefix}.${k}`),
  );
}
const I18N_KEYS = flatKeys(
  JSON.parse(readFileSync(path.join(ROOT, "client/src/i18n/en.json"), "utf8")) as unknown,
).filter((key) => key.includes("."));

/**
 * The user's own document and the quotes from it: English by rule, and checked
 * by the language rules only as document text, never as interface text (it may
 * hold Devanagari, prompt 17).
 */
const USER_TEXT = ".cc-doc, .cc-quote__text, .cc-results__name, textarea";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

/** The page-side checks, run in one evaluate. Kept free of closures over Node values. */
function pageChecks(input: {
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

async function focusWalk(page: Page): Promise<Violation[]> {
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

/**
 * CLS as Chrome defines it: the largest session window of layout shifts. The
 * window's biggest shifts are reported with the elements that moved (prompt 18),
 * so a failure names its cause and not only a number.
 */
function clsScript() {
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
  // Exemption (AUDIT.md, "Guard exemptions"): the moment a language the user
  // asked for is applied counts as input, like Chrome's 500 ms after a click.
  // Hindi strings and fonts load only after the toggle (SPEC section 9), so the
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

/**
 * axe takes seconds per page, and many tests end on the same page in the same
 * state. The same DOM at the same viewport gives the same result, so results
 * are kept per worker, keyed by project, address, language and a hash of the
 * markup. Any difference in the DOM means a fresh run.
 */
const axeCache = new Map<string, Violation[]>();

async function axeFindings(page: Page, project: string): Promise<Violation[]> {
  const signature = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    let hash = 2166136261;
    for (let i = 0; i < html.length; i += 1) {
      hash ^= html.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${location.pathname}|${document.documentElement.lang}|${String(html.length)}|${String(hash >>> 0)}`;
  });
  const key = `${project}|${signature}`;
  const cached = axeCache.get(key);
  if (cached !== undefined) return cached;
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const found: Violation[] = [];
  for (const v of axe.violations) {
    if (v.impact !== "serious" && v.impact !== "critical") continue;
    const target = v.nodes[0]?.target.join(" ") ?? "";
    found.push({
      check: "axe",
      detail: `${v.id} (${v.impact}) on ${String(v.nodes.length)} node(s), first: ${target}`,
    });
  }
  axeCache.set(key, found);
  return found;
}

interface Recorded {
  violations: Violation[];
  cls: Map<string, number>;
  /** The biggest shifts of each URL's worst window, with the elements that moved. */
  clsSources: Map<string, string>;
  expected: { url: RegExp; status: number | undefined }[];
}

function isExpected(recorded: Recorded, url: string, status: number) {
  return recorded.expected.some(
    (e) => e.url.test(url) && (e.status === undefined || e.status === status),
  );
}

async function runChecks(
  page: Page,
  testInfo: TestInfo,
  recorded: Recorded,
  origin: string,
): Promise<Violation[]> {
  const found = [...recorded.violations];
  for (const [url, value] of recorded.cls) {
    if (value > CLS_LIMIT) {
      found.push({
        check: "layout-shift",
        detail: `CLS ${value.toFixed(3)} on ${url} (limit ${String(CLS_LIMIT)}); shifts: ${recorded.clsSources.get(url) ?? "?"}`,
      });
    }
  }
  if (page.isClosed()) return found;
  let url: URL;
  try {
    url = new URL(page.url());
  } catch {
    return found;
  }
  if (url.origin !== origin) return found;
  // The checks are about the screen: a test that ended in print emulation is put back.
  await page.emulateMedia({ media: null });
  const phone = testInfo.project.use.isMobile === true;
  const dom = await page.evaluate(pageChecks, {
    phone,
    keys: I18N_KEYS,
    userText: USER_TEXT,
    minTarget: MIN_TARGET,
  });
  found.push(...(dom as Violation[]));
  found.push(...(await axeFindings(page, testInfo.project.name)));
  found.push(...(await focusWalk(page)));
  return found;
}

function format(violations: Violation[], shot: string | null) {
  const lines = violations.map((v) => `  [${v.check}] ${v.detail}`);
  return [
    `Oddity guard: ${String(violations.length)} problem(s)`,
    ...lines,
    ...(shot === null ? [] : [`  screenshot: ${shot}`]),
  ].join("\n");
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page, baseURL }, use, testInfo) => {
      // The test's own baseURL: a spec on a scenario server (A158) sets its own.
      const origin = new URL(String(baseURL ?? testInfo.project.use.baseURL)).origin;
      const recorded: Recorded = {
        violations: [],
        cls: new Map(),
        clsSources: new Map(),
        expected: [],
      };
      const add = (check: GuardCheck, detail: string) =>
        recorded.violations.push({ check, detail });

      page.on("console", (message) => {
        const type = message.type();
        if (type !== "error" && type !== "warning") return;
        const text = message.text();
        // Chrome's own line for an HTTP error response; the response itself is
        // judged by the network check, so an expected one is not counted twice.
        if (text.startsWith("Failed to load resource")) {
          const status = Number(/status of (\d+)/.exec(text)?.[1] ?? 0);
          if (isExpected(recorded, message.location().url, status)) return;
        }
        add("console", `console.${type === "warning" ? "warn" : "error"}: ${text.slice(0, 200)}`);
      });
      page.on("pageerror", (error) => {
        add("runtime", `${error.name}: ${error.message.slice(0, 200)}`);
      });
      page.on("request", (request) => {
        const target = new URL(request.url());
        if (target.protocol !== "http:" && target.protocol !== "https:") return;
        if (target.origin !== origin)
          add("network", `request to another host: ${target.origin}${target.pathname}`);
      });
      page.on("requestfailed", (request) => {
        const reason = request.failure()?.errorText ?? "";
        // The app aborts on purpose: a cancelled or superseded run, or a stale
        // translation (SPEC section 13 rule 5). See AUDIT.md.
        if (reason === "net::ERR_ABORTED") return;
        add("network", `request failed (${reason}): ${request.method()} ${request.url()}`);
      });
      page.on("response", (response) => {
        const status = response.status();
        if (status < 400 || isExpected(recorded, response.url(), status)) return;
        add(
          "network",
          `HTTP ${String(status)} not expected by the test: ${response.request().method()} ${response.url()}`,
        );
      });

      await page.exposeFunction("__ccGuardCls", (value: number, url: string, sources: string) => {
        if (value <= (recorded.cls.get(url) ?? 0)) return;
        recorded.cls.set(url, value);
        recorded.clsSources.set(url, sources);
      });
      await page.addInitScript(clsScript);

      const guard: Guard = {
        expectStatus: (url, status) => {
          recorded.expected.push({ url, status });
        },
        collect: () => runChecks(page, testInfo, recorded, origin),
        reset: () => {
          recorded.violations.length = 0;
          recorded.cls.clear();
          recorded.clsSources.clear();
        },
      };

      await use(guard);

      if (testInfo.status === "skipped") return;
      const violations = await runChecks(page, testInfo, recorded, origin);
      if (violations.length === 0) return;
      let shot: string | null = null;
      if (!page.isClosed()) {
        // Taken only on a finding, with the focus walk's focus cleared first.
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
        const dir = path.join(ROOT, "audit", "screens", "guard", testInfo.project.name);
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${slug(testInfo.titlePath.slice(1).join(" "))}.png`);
        await page.screenshot({ path: file, fullPage: true });
        shot = path.relative(ROOT, file).replace(/\\/g, "/");
      }
      await testInfo.attach("oddity-guard.json", {
        body: JSON.stringify(violations, null, 2),
        contentType: "application/json",
      });
      throw new Error(format(violations, shot));
    },
    { auto: true },
  ],
});

export { expect };
export type { Locator, Page, TestInfo } from "@playwright/test";
