import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "./guard.js";
import type { AnalysisResult, Flag } from "../../shared/src/schemas.js";

// Prompt 14: glossary tooltips (SPEC F18, section 9) in the explanations, the
// clause readings and the document viewer, by mouse, keyboard and touch.
const ROOT = process.cwd();
const rental = (
  JSON.parse(readFileSync(path.join(ROOT, "fixtures/samples/rental.json"), "utf8")) as {
    en: AnalysisResult;
  }
).en;

test.use({ reducedMotion: "reduce" });

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The terms the page should mark in one paragraph: each once, first whole-word match. */
function expectedTerms(text: string): string[] {
  const hits: { start: number; end: number; term: string }[] = [];
  for (const { term } of rental.glossary) {
    const m = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${escape(term)}(?![\\p{L}\\p{M}\\p{N}])`,
      "iu",
    ).exec(text);
    if (m === null) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (hits.some((h) => start < h.end && end > h.start)) continue;
    hits.push({ start, end, term });
  }
  return hits.sort((a, b) => a.start - b.start).map((h) => h.term.toLowerCase());
}

function ranked(flags: readonly Flag[]): Flag[] {
  const rank = (f: Flag) => (f.kind === "missing" ? 2 : f.severity === "high" ? 0 : 1);
  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.i - b.i)
    .map(({ flag }) => flag);
}
const first = ranked(rental.flags)[0];
if (first === undefined) throw new Error("no flags");

const tipOf = async (page: Page, term: Locator) =>
  page.locator(`[id="${(await term.getAttribute("aria-describedby")) ?? ""}"]`);

async function openSample(page: Page) {
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
}

/** The document viewer: the aside on wide screens, the sheet (opened from flag 1) below 1024. */
async function viewer(page: Page): Promise<Locator> {
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.locator(`[data-flag-id="${first?.id ?? ""}"] .cc-flag__head`).click();
    await expect(page.locator("dialog.cc-sheet-dialog[open]")).toHaveCount(1);
  }
  return page.getByTestId("document-viewer");
}

test("the document viewer marks each glossary term once per clause", async ({ page }) => {
  await openSample(page);
  const panel = await viewer(page);
  let total = 0;
  for (const segment of rental.segments) {
    const want = expectedTerms(segment.text);
    total += want.length;
    const got = await panel
      .locator(`[data-segment-id="${segment.id}"] .cc-term`)
      .evaluateAll((els) => els.map((el) => el.textContent.toLowerCase()));
    expect(got, segment.id).toEqual(want);
  }
  expect(total).toBeGreaterThan(0);
  // Every term button has its note, which is a tooltip in the page language.
  const terms = panel.locator(".cc-term");
  await expect(terms).toHaveCount(total);
  const term = terms.first();
  await expect(await tipOf(page, term)).toHaveAttribute("role", "tooltip");
});

test("the clause readings mark their terms once per reading", async ({ page }) => {
  await openSample(page);
  let total = 0;
  for (const clause of rental.clauses) {
    const want = expectedTerms(clause.plain);
    total += want.length;
    const got = await page
      .locator(`.cc-clause[data-clause-segment="${clause.segmentId}"] .cc-term`)
      .evaluateAll((els) => els.map((el) => el.textContent.toLowerCase()));
    expect(got, clause.id).toEqual(want);
  }
  expect(total).toBeGreaterThan(0);
});

test("mouse: hover opens and leaving closes; a click pins it until a click outside", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.use.isMobile === true, "mouse hover is checked on desktop projects");
  await openSample(page);
  const term = page.locator(".cc-clause .cc-term").first();
  const tip = await tipOf(page, term);
  await term.hover();
  await expect(tip).toBeVisible();
  await expect(term).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(2, 2);
  await expect(tip).toBeHidden();

  await term.click();
  await expect(tip).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(tip).toBeVisible();
  await page.locator(".cc-results__disclaimer").click();
  await expect(tip).toBeHidden();
});

test("keyboard: focus opens, Esc closes, Tab moves on and closes it", async ({ page }) => {
  await openSample(page);
  const term = page.locator(".cc-clause .cc-term").first();
  const tip = await tipOf(page, term);
  await term.focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(term).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(term).toBeFocused();
  await expect(tip).toBeVisible();
  // Never traps focus: Tab leaves the term and the note goes with it.
  await page.keyboard.press("Tab");
  await expect(term).not.toBeFocused();
  await expect(tip).toBeHidden();
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("a tap opens the note and a tap outside closes it", async ({ page }) => {
    await openSample(page);
    const term = page.locator(".cc-clause .cc-term").first();
    await term.scrollIntoViewIfNeeded();
    const tip = await tipOf(page, term);
    await term.tap();
    await expect(tip).toBeVisible();
    await page.locator(".cc-results__disclaimer").tap();
    await expect(tip).toBeHidden();
    // A second tap on the open term closes it too.
    await term.tap();
    await expect(tip).toBeVisible();
    await term.tap();
    await expect(tip).toBeHidden();
  });
});

test("the note flips above its clause when there is no room below in the panel", async ({
  page,
}) => {
  await openSample(page);
  const panel = await viewer(page);
  // The term in the shortest clause that the panel can scroll to its top, so the
  // clause can sit at the top or the bottom of what is on screen.
  const index = await panel.evaluate((body) => {
    let best = -1;
    let shortest = Infinity;
    body.querySelectorAll<HTMLElement>(".cc-term").forEach((term, i) => {
      const clause = term.closest<HTMLElement>(".cc-doc__segment");
      if (clause === null || clause.offsetTop < body.clientHeight) return;
      if (clause.offsetTop + body.clientHeight > body.scrollHeight) return;
      if (clause.offsetHeight < shortest) {
        shortest = clause.offsetHeight;
        best = i;
      }
    });
    return best;
  });
  expect(index).toBeGreaterThanOrEqual(0);
  const term = panel.locator(".cc-term").nth(index);
  const segment = term.locator("xpath=ancestor::div[contains(@class, 'cc-doc__segment')]");
  const tip = await tipOf(page, term);
  /** The part of the panel on screen: the panel can reach past the window on a short screen. */
  const visible = () =>
    panel.evaluate((body) => {
      const r = body.getBoundingClientRect();
      return { top: Math.max(r.top, 0), bottom: Math.min(r.bottom, window.innerHeight) };
    });
  const inside = async () => {
    const v = await visible();
    const t = await tip.boundingBox();
    if (t === null) throw new Error("no layout");
    return t.y >= v.top - 1 && t.y + t.height <= v.bottom + 1;
  };
  const place = (where: "top" | "bottom") =>
    segment.evaluate((el: HTMLElement, at) => {
      const body = el.closest<HTMLElement>(".cc-doc__body");
      if (body === null) return;
      const r = body.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      body.scrollTop +=
        at === "top"
          ? box.top - (Math.max(r.top, 0) + 4)
          : box.bottom - (Math.min(r.bottom, window.innerHeight) - 8);
    }, where);
  const focusTerm = () =>
    term.evaluate((el) => {
      el.blur();
      el.focus({ preventScroll: true });
    });

  // Clause at the bottom of what is on screen: the note opens above it.
  await place("bottom");
  await focusTerm();
  await expect(tip).toBeVisible();
  await expect(tip.locator("xpath=..")).toHaveClass(/cc-gloss__tip--above/);
  expect(await inside()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();

  // Clause at the top: the note opens below it.
  await place("top");
  await focusTerm();
  await expect(tip).toBeVisible();
  await expect(tip.locator("xpath=..")).not.toHaveClass(/cc-gloss__tip--above/);
  // Where neither side has room (the 320 x 568 sheet), the panel scrolls to show it.
  await expect.poll(inside).toBe(true);
});

test("Esc inside the bottom sheet closes the note and keeps the sheet", async ({
  page,
}, testInfo) => {
  test.skip(
    !["mobile", "small-phone", "tablet"].includes(testInfo.project.name),
    "the sheet exists below 1024 px",
  );
  await openSample(page);
  const panel = await viewer(page);
  const term = panel.locator(".cc-term").first();
  const tip = await tipOf(page, term);
  await term.focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(page.locator("dialog.cc-sheet-dialog[open]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.cc-sheet-dialog[open]")).toHaveCount(0);
});
