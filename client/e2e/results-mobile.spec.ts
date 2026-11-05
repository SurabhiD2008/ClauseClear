import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import type { AnalysisResult, Flag } from "../../shared/src/schemas.js";

// Prompt 13: results below 1024 px on the mobile (390) and small-phone (320)
// projects. The document is a bottom sheet (SPEC section 9, "Responsive rules").
const ROOT = process.cwd();
const rental = (
  JSON.parse(readFileSync(path.join(ROOT, "fixtures/samples/rental.json"), "utf8")) as {
    en: AnalysisResult;
  }
).en;
const DEVANAGARI = /[ऀ-ॿ]/;

function ranked(flags: readonly Flag[]): Flag[] {
  const rank = (f: Flag) => (f.kind === "missing" ? 2 : f.severity === "high" ? 0 : 1);
  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.i - b.i)
    .map(({ flag }) => flag);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const order = ranked(rental.flags);
const present = order.filter((f) => f.kind === "present");
const firstFlag = order[0];
if (firstFlag === undefined) throw new Error("the rental sample has flags");

// See results.spec.ts: smooth page scrolling moves buttons mid-click.
test.use({ reducedMotion: "reduce" });

// Playwright requires the fixtures argument to be a destructuring pattern.
test.beforeEach(({}, testInfo) => {
  test.skip(
    !["mobile", "small-phone"].includes(testInfo.project.name),
    "bottom-sheet behaviour is checked on the phone projects",
  );
});

const sheet = (page: Page) => page.locator("dialog.cc-sheet-dialog[open]");
const head = (page: Page, flag: Flag) => page.locator(`[data-flag-id="${flag.id}"] .cc-flag__head`);

async function openSample(page: Page) {
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
}

async function expandAll(page: Page) {
  const more = page.getByRole("button", { name: /^See \d+ more flags$/ });
  if (await more.isVisible()) await more.click();
}

/** The clause is inside the sheet's scrolling body, at or near its top. */
async function clauseInView(page: Page, segmentId: string): Promise<boolean> {
  return sheet(page)
    .getByTestId("document-viewer")
    .evaluate((panel, id) => {
      const clause = panel.querySelector(`[data-segment-id="${id}"]`);
      if (clause === null) return false;
      const a = panel.getBoundingClientRect();
      const b = clause.getBoundingClientRect();
      return b.top >= a.top - 1 && b.top < a.bottom - 20;
    }, segmentId);
}

test("the sheet opens at 65 percent height, locks the page and closes three ways", async ({
  page,
}) => {
  await openSample(page);
  const htmlOverflow = () => page.evaluate(() => document.documentElement.style.overflow);

  // 1. Selecting a flag opens the sheet; the close button returns focus to the flag.
  await head(page, firstFlag).click();
  await expect(sheet(page)).toHaveCount(1);
  const dialog = page.getByRole("dialog", { name: "Clause 4 of your document" });
  await expect(dialog).toBeVisible();
  const box = await sheet(page).boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("no layout");
  expect(Math.abs(box.height - viewport.height * 0.65)).toBeLessThan(2);
  expect(Math.round(box.y + box.height)).toBe(viewport.height);
  expect(await htmlOverflow()).toBe("hidden");
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(head(page, firstFlag)).toBeFocused();
  expect(await htmlOverflow()).toBe("");

  // 2. "Find it in the document" opens it; Esc closes it and focus returns to that button.
  const find = page.getByRole("button", { name: "Find it in the document" });
  await find.click();
  await expect(sheet(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(find).toBeFocused();

  // 3. A tap on the backdrop above the sheet closes it.
  await find.click();
  await expect(sheet(page)).toHaveCount(1);
  await page.mouse.click(viewport.width / 2, 20);
  await expect(sheet(page)).toHaveCount(0);
  await expect(find).toBeFocused();
  expect(await htmlOverflow()).toBe("");
});

test("the page does not scroll behind the open sheet", async ({ page }) => {
  await openSample(page);
  await head(page, firstFlag).click();
  await expect(sheet(page)).toHaveCount(1);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(100, 30);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("focus stays inside the sheet: Tab and Shift+Tab wrap", async ({ page }) => {
  await openSample(page);
  await head(page, firstFlag).click();
  await expect(sheet(page)).toHaveCount(1);
  const inside = () =>
    page.evaluate(() => document.activeElement?.closest("dialog.cc-sheet-dialog") !== null);
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
  }
});

test("selecting each flag opens the sheet at its clause with the quote marked", async ({
  page,
}) => {
  await openSample(page);
  await expandAll(page);
  for (const flag of present) {
    await head(page, flag).click();
    await expect(sheet(page)).toHaveCount(1);
    const segmentId = flag.segmentId ?? "";
    const n = segmentId.slice(1);
    await expect(page.getByRole("dialog", { name: `Clause ${n} of your document` })).toBeVisible();
    const mark = sheet(page).locator(`[data-segment-id="${segmentId}"] mark`);
    await expect(mark).toHaveAttribute("data-flag-id", flag.id);
    expect(squash(await mark.innerText())).toBe(squash(flag.quote ?? ""));
    await expect(sheet(page).locator("mark")).toHaveCount(1);
    await expect.poll(() => clauseInView(page, segmentId)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(head(page, flag)).toBeFocused();
  }
  // A missing item has no clause: it opens in the list and the sheet stays shut.
  const missing = order.find((f) => f.kind === "missing");
  if (missing !== undefined) {
    await head(page, missing).click();
    await expect(head(page, missing)).toHaveAttribute("aria-expanded", "true");
    await expect(sheet(page)).toHaveCount(0);
  }
});

test("the Hindi toggle keeps the sheet open and the same flag selected", async ({ page }) => {
  await openSample(page);
  const second = present[1];
  if (second === undefined) throw new Error("need two flags with clauses");
  await head(page, second).click();
  await expect(sheet(page)).toHaveCount(1);

  // The header toggle is behind the backdrop, so the sheet carries its own.
  await sheet(page).getByRole("button", { name: /^HI/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(sheet(page)).toHaveCount(1);
  await expect(sheet(page).locator(".cc-sheet__title")).toHaveText(DEVANAGARI);
  await expect(sheet(page).locator(`mark[data-flag-id="${second.id}"]`)).toHaveCount(1);
  // The document stays English.
  await expect(sheet(page).getByTestId("document-viewer")).toHaveAttribute("lang", "en");
  await expect(head(page, second)).toHaveAttribute("aria-expanded", "true");

  await sheet(page).getByRole("button", { name: /^EN/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(sheet(page)).toHaveCount(1);
  await expect(sheet(page).locator(`mark[data-flag-id="${second.id}"]`)).toHaveCount(1);

  // Closing after the toggles still returns focus to the flag that opened it.
  await page.keyboard.press("Escape");
  await expect(head(page, second)).toBeFocused();
});

test("below 640 px: smaller score, stamps and numbers, rotations under 1 degree, short list", async ({
  page,
}) => {
  await openSample(page);
  const px = (selector: string, prop: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el, p) => parseFloat(getComputedStyle(el).getPropertyValue(p)), prop);
  expect(await px(".cc-score__value", "font-size")).toBe(88);
  expect(await px(".cc-verdict__title", "font-size")).toBe(44);
  expect(await px(".cc-flag__number", "font-size")).toBe(28);
  expect(await px(".cc-stamp", "font-size")).toBe(11);

  const tilts = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .map((el) => getComputedStyle(el).transform)
      .filter((t) => t !== "none")
      .map((t) => {
        const m = new DOMMatrixReadOnly(t);
        return Math.abs((Math.atan2(m.b, m.a) * 180) / Math.PI);
      }),
  );
  expect(tilts.length).toBeGreaterThan(0);
  expect(Math.max(...tilts)).toBeLessThan(1);

  // The header has only the wordmark and the toggle; the nav links are in the footer.
  await expect(page.getByRole("banner").getByRole("navigation")).toBeHidden();

  // Three flags, then "See 8 more flags", which reveals the rest and moves focus to the fourth.
  await expect(page.locator(".cc-flag")).toHaveCount(3);
  const more = page.getByRole("button", { name: `See ${String(order.length - 3)} more flags` });
  await more.click();
  await expect(page.locator(".cc-flag")).toHaveCount(order.length);
  await expect(head(page, order[3] ?? firstFlag)).toBeFocused();
});

test("no horizontal scroll with the sheet open or closed", async ({ page }) => {
  await openSample(page);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(0);
  await head(page, firstFlag).click();
  await expect(sheet(page)).toHaveCount(1);
  expect(await overflow()).toBe(0);
  const sheetOverflow = await sheet(page)
    .getByTestId("document-viewer")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sheetOverflow).toBe(0);
});
