import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import { DEVANAGARI, ROOT, rental } from "./helpers/data.js";
import { choosePdf, phoneLayout, streamedResult } from "./helpers/flows.js";
import { ERROR_CODES } from "../../shared/src/errors.js";
import type { Flag } from "../../shared/src/schemas.js";

// The main user flows that no other spec covers end to end.
// Flows covered elsewhere:
// every flag with its highlight (results.spec.ts), the filter (results.spec.ts),
// checklist ticking (checklist.spec.ts), each error code (landing.spec.ts),
// cancel (landing.spec.ts, cancel.spec.ts), paste (landing.spec.ts), the bottom
// sheet (results-mobile.spec.ts) and print (states.spec.ts, checklist.spec.ts).

function ranked(flags: readonly Flag[]): Flag[] {
  const rank = (f: Flag) => (f.kind === "missing" ? 2 : f.severity === "high" ? 0 : 1);
  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.i - b.i)
    .map(({ flag }) => flag);
}
const present = ranked(rental.flags).filter((f) => f.kind === "present");

const head = (page: Page, flag: Flag) => page.locator(`[data-flag-id="${flag.id}"] .cc-flag__head`);
const sheet = (page: Page) => page.locator("dialog.cc-sheet-dialog[open]");

/** The header toggle, or the sheet's own one while the modal sheet is open. */
async function toggleLanguage(page: Page, lang: "en" | "hi") {
  const scope = (await sheet(page).count()) > 0 ? sheet(page) : page.locator("header.cc-header");
  await scope.getByRole("button", { name: lang === "hi" ? /^HI/ : /^EN/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

async function closeSheet(page: Page) {
  if ((await sheet(page).count()) === 0) return;
  await page.mouse.move(0, 0);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
}

/** The viewer that holds the marks: the sticky panel, or the sheet below 1024 px. */
const viewer = (page: Page) =>
  phoneLayout(page)
    ? sheet(page).getByTestId("document-viewer")
    : page.getByTestId("document-viewer");

// Smooth scrolling moves buttons mid-click (results.spec.ts covers motion).
test.use({ reducedMotion: "reduce" });

test("landing to sample to results: a flag selected shows its quote in the document", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/analyze")) calls.push(r.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Rental agreement" }).click();
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await expect(page.locator(".cc-flag")).toHaveCount(
    Math.min(rental.flags.length, (page.viewportSize()?.width ?? 0) < 640 ? 3 : Infinity),
  );

  const first = present[0];
  if (first === undefined) throw new Error("the rental sample has a flag with a quote");
  await head(page, first).click();
  await expect(head(page, first)).toHaveAttribute("aria-expanded", "true");
  const mark = viewer(page).locator(`mark[data-flag-id="${first.id}"]`);
  await expect(mark).toHaveCount(1);
  expect((await mark.innerText()).replace(/\s+/g, " ").trim()).toBe(
    (first.quote ?? "").replace(/\s+/g, " ").trim(),
  );
  // Samples cost no API call.
  expect(calls).toEqual([]);
});

test("Hindi and back keeps the selected flag, the open sheet and the ticks", async ({ page }) => {
  const flag = present[1];
  const item = rental.checklist.before[0];
  if (flag === undefined || item === undefined) throw new Error("fixture too small");
  const box = page.locator(`[data-item-id="${item.id}"] input[type="checkbox"]`);

  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  // Tick one item first, then come back (going from results to the checklist keeps everything).
  await page.locator(".cc-results__next a").click();
  await expect(page).toHaveURL(/\/checklist$/);
  await box.check();
  await page.locator(".cc-checklist__back").click();
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);

  await head(page, flag).click();
  await expect(head(page, flag)).toHaveAttribute("aria-expanded", "true");
  if (phoneLayout(page)) await expect(sheet(page)).toHaveCount(1);

  await toggleLanguage(page, "hi");
  await expect(head(page, flag)).toHaveAttribute("aria-expanded", "true");
  await expect(viewer(page).locator(`mark[data-flag-id="${flag.id}"]`)).toHaveCount(1);
  if (phoneLayout(page)) await expect(sheet(page)).toHaveCount(1);
  await expect(page.locator(`[data-flag-id="${flag.id}"] .cc-flag__label`)).toHaveText(DEVANAGARI);

  await toggleLanguage(page, "en");
  await expect(head(page, flag)).toHaveAttribute("aria-expanded", "true");
  await expect(viewer(page).locator(`mark[data-flag-id="${flag.id}"]`)).toHaveCount(1);
  if (phoneLayout(page)) await expect(sheet(page)).toHaveCount(1);

  // The tick survived both toggles and the trip back and forth.
  await closeSheet(page);
  await toggleLanguage(page, "hi");
  await page.locator(".cc-results__next a").click();
  await expect(page).toHaveURL(/\/checklist$/);
  await expect(box).toBeChecked();
  await toggleLanguage(page, "en");
  await expect(box).toBeChecked();
  await expect(page.locator(".cc-progress__count")).toHaveText(
    `1 of ${String(rental.checklist.before.length + rental.checklist.after.length)} done`,
  );
  // And the selection is still there on the way back.
  await page.locator(".cc-checklist__back").click();
  await expect(head(page, flag)).toHaveAttribute("aria-expanded", "true");
});

test.describe("upload happy path for each detailed type", () => {
  const cases: [string, RegExp][] = [
    ["rental.pdf", /rental|leave and licen[cs]e/i],
    ["employment.pdf", /employment|job/i],
    ["loan.pdf", /loan|credit/i],
    ["terms.pdf", /terms/i],
  ];
  for (const [file, type] of cases) {
    test(file, async ({ page }) => {
      await page.goto("/");
      const result = await streamedResult(page, async () => {
        await choosePdf(page, file);
        await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
      });
      await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
      await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
      await expect(page.locator(".cc-verdict__detected")).toHaveText(type);
      // Every flag shown is one the server verified: its quote is in its segment.
      const text = new Map(result.segments.map((s) => [s.id, s.text]));
      const shown = await page
        .locator(".cc-flag")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-flag-id")));
      expect(shown.length).toBeGreaterThan(0);
      for (const id of shown) {
        const flag = result.flags.find((f) => f.id === id);
        expect(flag, String(id)).toBeDefined();
        if (flag?.kind === "present") {
          expect(text.get(flag.segmentId ?? "")).toContain(flag.quote);
        }
      }
    });
  }
});

// A static check of the spec files: @once runs it on one project.
test("every shared error code has a UI test", { tag: "@once" }, () => {
  const titles = readdirSync(path.join(ROOT, "client/e2e"))
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => readFileSync(path.join(ROOT, "client/e2e", f), "utf8"))
    .join("\n");
  // A code counts as covered when a test asserts its strip by data-error-code
  // or names it in a title, as landing.spec.ts does for each one.
  const uncovered = ERROR_CODES.filter(
    (code) => !new RegExp(`["'\`\\[]${code}["'\`\\] (]`).test(titles),
  );
  expect(uncovered).toEqual([]);
});

test("keyboard only: sample, a flag, the checklist and a tick", async ({ page }) => {
  await page.goto("/");
  const tabTo = async (match: (el: { text: string; cls: string; tag: string }) => boolean) => {
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press("Tab");
      const el = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return {
          text: (a?.textContent ?? "").trim(),
          cls: typeof a?.className === "string" ? a.className : "",
          tag: a?.tagName.toLowerCase() ?? "",
        };
      });
      if (match(el)) return;
    }
    throw new Error("Tab never reached the control");
  };

  await tabTo((el) => el.tag === "a" && el.text === "Rental agreement");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();

  await tabTo((el) => el.cls.includes("cc-flag__head"));
  const focused = page.locator(".cc-flag__head:focus");
  const id = await focused.evaluate((el) =>
    el.closest("[data-flag-id]")?.getAttribute("data-flag-id"),
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(`[data-flag-id="${id ?? ""}"] .cc-flag__head`)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const flag = rental.flags.find((f) => f.id === id);
  if (flag?.kind === "present") {
    if (phoneLayout(page)) await expect(sheet(page)).toHaveCount(1);
    await expect(viewer(page).locator(`mark[data-flag-id="${id ?? ""}"]`)).toHaveCount(1);
    if (phoneLayout(page)) {
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.locator(`[data-flag-id="${id ?? ""}"] .cc-flag__head`)).toBeFocused();
    }
  }

  await tabTo((el) => el.tag === "a" && el.text.startsWith("Next: your before-and-after"));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/checklist$/);
  await tabTo((el) => el.tag === "input");
  await page.keyboard.press("Space");
  await expect(page.locator('input[type="checkbox"]:focus')).toBeChecked();
  await expect(page.locator(".cc-progress__count")).toHaveText(/^1 of \d+ done$/);
});
