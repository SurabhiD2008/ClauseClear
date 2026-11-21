import { expect, test } from "./guard.js";
import { LEASE } from "./helpers/data.js";
import { en, message, pasteText } from "./helpers/landing.js";

// The landing page's cancel flow and its layout at every width, against the
// mock provider (playwright.config.ts runs MOCK_SCENARIO=slow).
test("Cancel: the slow notice at 20 s, then CANCELLED with a retry", async ({ page }) => {
  await page.clock.install();
  // Hold the request open, so only Cancel can end the run.
  await page.route("**/api/analyze", () => new Promise<void>(() => undefined));
  await page.goto("/");
  await pasteText(page, LEASE);

  const cancel = page.getByRole("button", { name: "Cancel" });
  // Focus moves to Cancel on the next frame; the installed clock holds frames until it runs.
  await page.clock.runFor(100);
  await expect(cancel).toBeFocused();
  await expect(page.getByText(en.landing.slow ?? "")).toBeHidden();
  await page.clock.fastForward(20_000);
  await expect(page.getByText(en.landing.slow ?? "")).toBeVisible();

  await cancel.click();
  const strip = page.locator('[role="alert"][data-error-code="CANCELLED"]');
  await expect(strip).toContainText(message("CANCELLED"));
  await expect(page.locator(".cc-hero__error")).toBeFocused();
  await expect(strip.getByRole("button", { name: "Try again" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose a PDF" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

// The sweep sets its own widths, so @once runs it on one project.
test("no horizontal scroll from 320 to 1920 px", { tag: "@once" }, async ({ page }) => {
  const widths = [320, 360, 390, 480, 640, 768, 1024, 1280, 1360, 1440, 1920];
  const overflow: Record<number, number> = {};
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    overflow[width] = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  }
  expect(overflow).toEqual(Object.fromEntries(widths.map((w) => [w, 0])));
});

test("every visible target on the landing page is at least 44 px", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, textarea, [tabindex]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.getAttribute("tabindex") !== "-1";
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: el.innerText.trim() || el.tagName,
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter((t) => t.w < 44 || t.h < 44),
  );
  expect(small).toEqual([]);
});
