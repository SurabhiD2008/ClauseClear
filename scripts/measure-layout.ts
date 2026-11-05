/// <reference lib="dom" />
// The in-page half of this script uses the DOM; the scripts tsconfig is Node-only.
// Measures the results and checklist pages for layout offenders (prompts 13 and 14, SPEC section 9
// "Responsive rules" and F21, F22) and prints each one by selector:
//   overflow  an element reaches past the viewport's left or right edge
//   clipped   an element cuts off its own text (overflow hidden or clip, content wider or taller)
//   target    a control smaller than 44 x 44 px
//   tilt      a rotation of 1 degree or more below 640 px
// It needs a running server (npm run build && npm run start) and makes no AI
// calls: it opens the bundled rental sample.
//   MEASURE_URL=http://127.0.0.1:4173 npm run measure:layout
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.MEASURE_URL ?? "http://127.0.0.1:4173";
const WIDTHS = [320, 360, 390, 768, 1024];
const ROUTE = "/results/sample/rental";

interface Offender {
  kind: "overflow" | "clipped" | "target" | "tilt";
  selector: string;
  detail: string;
}

/** Runs in the page: finds every offender in the current state. */
function findOffenders(): Offender[] {
  const out: Offender[] = [];
  const width = document.documentElement.clientWidth;

  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node !== null && node !== document.body && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.id !== "" && !node.id.includes(":")) {
        parts.unshift(`${part}#${node.id}`);
        break;
      }
      const classes = [...node.classList].filter((c) => c.startsWith("cc-")).slice(0, 2);
      if (classes.length > 0) part += `.${classes.join(".")}`;
      const testId = node.getAttribute("data-flag-id") ?? node.getAttribute("data-segment-id");
      if (testId !== null) part += `[${testId}]`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  const visible = (el: Element): boolean => {
    if (el.closest(".cc-visually-hidden, [hidden]") !== null) {
      return false;
    }
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // An element inside a scroll container may extend past the viewport legitimately
  // only if its container stays inside; the container is then what is measured.
  const insideScroller = (el: Element): boolean => {
    let node = el.parentElement;
    while (node !== null && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) return true;
      node = node.parentElement;
    }
    return false;
  };

  if (document.documentElement.scrollWidth > width) {
    out.push({
      kind: "overflow",
      selector: "html",
      detail: `page scrollWidth ${String(document.documentElement.scrollWidth)} > ${String(width)}`,
    });
  }

  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    if (
      (r.right > width + 0.5 || r.left < -0.5) &&
      !insideScroller(el) &&
      style.position !== "fixed"
    ) {
      out.push({
        kind: "overflow",
        selector: selectorOf(el),
        detail: `left ${r.left.toFixed(1)} right ${r.right.toFixed(1)} (viewport ${String(width)})`,
      });
    }

    const clipsX = /(hidden|clip)/.test(style.overflowX);
    const clipsY = /(hidden|clip)/.test(style.overflowY);
    const hasText = el.textContent.trim() !== "";
    if (hasText && clipsX && el.scrollWidth > el.clientWidth + 1) {
      out.push({
        kind: "clipped",
        selector: selectorOf(el),
        detail: `scrollWidth ${String(el.scrollWidth)} > clientWidth ${String(el.clientWidth)}`,
      });
    }
    if (hasText && clipsY && el.scrollHeight > el.clientHeight + 1) {
      out.push({
        kind: "clipped",
        selector: selectorOf(el),
        detail: `scrollHeight ${String(el.scrollHeight)} > clientHeight ${String(el.clientHeight)}`,
      });
    }
    if (style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) {
      out.push({ kind: "clipped", selector: selectorOf(el), detail: "text cut with an ellipsis" });
    }

    if (width < 640 && style.transform !== "none") {
      const m = new DOMMatrixReadOnly(style.transform);
      const degrees = Math.abs((Math.atan2(m.b, m.a) * 180) / Math.PI);
      if (degrees >= 1 - 1e-6) {
        out.push({
          kind: "tilt",
          selector: selectorOf(el),
          detail: `rotated ${degrees.toFixed(2)} deg`,
        });
      }
    }
  }

  const controls = document.body.querySelectorAll<HTMLElement>(
    "a[href], button, input:not([type='hidden']), select, textarea, [tabindex]:not([tabindex='-1']), [role='button']",
  );
  for (const el of controls) {
    if (!visible(el) || el.getAttribute("tabindex") === "-1") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 - 0.01 || r.height < 44 - 0.01) {
      const name = el.innerText !== "" ? el.innerText : (el.getAttribute("aria-label") ?? "");
      out.push({
        kind: "target",
        selector: selectorOf(el),
        detail: `${r.width.toFixed(1)} x ${r.height.toFixed(1)} "${name.trim().slice(0, 30)}"`,
      });
    }
  }
  return out;
}

async function measure(page: Page, label: string): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  const offenders = await page.evaluate(findOffenders);
  // One line per distinct selector and kind; repeated rows (34 segments) collapse with a count.
  const grouped = new Map<string, { offender: Offender; count: number }>();
  for (const offender of offenders) {
    const key = `${offender.kind} ${offender.selector}`;
    const entry = grouped.get(key);
    if (entry === undefined) grouped.set(key, { offender, count: 1 });
    else entry.count += 1;
  }
  // The counts show the sweep really ran over the page, not over an empty one.
  const checked = await page.evaluate(() => ({
    elements: document.body.querySelectorAll("*").length,
    controls: document.body.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")
      .length,
  }));
  console.log(
    `\n== ${label}: ${String(offenders.length)} offender(s) in ${String(checked.elements)} elements, ${String(checked.controls)} controls`,
  );
  for (const { offender, count } of grouped.values()) {
    const times = count > 1 ? ` (x${String(count)})` : "";
    console.log(`  ${offender.kind.padEnd(8)} ${offender.selector}${times}  ${offender.detail}`);
  }
  return offenders.length;
}

const browser = await chromium.launch();
let total = 0;
for (const width of WIDTHS) {
  const mobile = width < 768;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 800 : 1000 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce",
  });
  // tsx keeps function names with an injected __name helper; findOffenders runs in the page, so define it there.
  await context.addInitScript("globalThis.__name = (fn) => fn;");
  const page = await context.newPage();
  await page.goto(`${BASE}${ROUTE}`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  // The mockups show the first flag open, with its quote strip and glossary term.
  await page.locator(".cc-flag__head").first().click();

  // Below 1024 px selecting a flag opens the document as a bottom sheet (prompt 13):
  // measure the sheet, close it, measure the page, then reopen it from the button.
  const sheet = page.locator("dialog.cc-sheet-dialog[open]");
  if (width < 1024 && (await sheet.count()) > 0) {
    total += await measure(page, `${String(width)} px, results, sheet open from flag 1`);
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
  }
  total += await measure(page, `${String(width)} px, results, flag 1 open`);

  const find = page.getByRole("button", { name: "Find it in the document" });
  if (width < 1024) {
    if ((await find.count()) > 0 && (await find.first().isVisible())) {
      await find.first().click();
      await sheet.waitFor();
      total += await measure(page, `${String(width)} px, results, sheet open from Find`);
    } else {
      console.log(
        `\n== ${String(width)} px: no "Find it in the document" button, so no bottom sheet to measure`,
      );
    }
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
  }

  // The checklist (prompt 14), reached the way a reader reaches it, with one item ticked.
  await page.getByRole("link", { name: /before-and-after checklist/ }).click();
  await page.getByRole("checkbox").first().check();
  total += await measure(page, `${String(width)} px, checklist, one item ticked`);
  await context.close();
}
await browser.close();
console.log(`\nTotal offenders: ${String(total)}`);
process.exitCode = total === 0 ? 0 : 1;
