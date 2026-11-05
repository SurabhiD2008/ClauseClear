import { expect, test, type Page } from "./guard.js";

// Same range as DEVANAGARI_PATTERN in /shared. Kept local so the spec does not
// depend on a built shared package when Playwright loads it.
const DEVANAGARI = /[ऀ-ॿ]/;
// The lazy Hindi chunk (hindiAssets-*.js/.css) and every Devanagari font file.
const HINDI_ASSET = /hindiAssets|devanagari/i;

function watchHindiRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (HINDI_ASSET.test(request.url())) seen.push(new URL(request.url()).pathname);
  });
  return seen;
}

async function pageHtml(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.outerHTML);
}

const hiButton = (page: Page) => page.getByRole("button", { name: /^HI\b/ });
const enButton = (page: Page) => page.getByRole("button", { name: /^EN\b/ });

test.describe("first visit", () => {
  test("a fresh browser context shows no Devanagari and loads no Hindi assets", async ({
    page,
  }) => {
    const hindiRequests = watchHindiRequests(page);
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(DEVANAGARI.test(await pageHtml(page))).toBe(false);
    expect(DEVANAGARI.test(await page.locator("body").innerText())).toBe(false);
    expect(hindiRequests).toEqual([]);
    await expect(enButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(hiButton(page)).toHaveAttribute("aria-pressed", "false");
  });

  test.describe("with a Hindi browser locale", () => {
    test.use({ locale: "hi-IN" });

    test("still starts in English", async ({ page }) => {
      const hindiRequests = watchHindiRequests(page);
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      expect(DEVANAGARI.test(await pageHtml(page))).toBe(false);
      expect(hindiRequests).toEqual([]);
    });
  });
});

test("toggling updates html lang, persists across reloads, and switches back", async ({ page }) => {
  const hindiRequests = watchHindiRequests(page);
  await page.goto("/");

  await hiButton(page).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(hiButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(enButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(DEVANAGARI);
  expect(await page.evaluate(() => localStorage.getItem("cc.lang"))).toBe("hi");
  expect(hindiRequests.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(DEVANAGARI);

  await enButton(page).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => localStorage.getItem("cc.lang"))).toBe("en");
  expect(DEVANAGARI.test(await pageHtml(page))).toBe(false);
});

test("the toggle buttons are at least 44px tall and wide", async ({ page }) => {
  await page.goto("/");
  for (const button of [enButton(page), hiButton(page)]) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});

test("the nav links show in the header from 640px up; below that they move to the footer", async ({
  page,
}) => {
  await page.goto("/");
  const width = page.viewportSize()?.width ?? 0;
  const headerNav = page.getByRole("banner").getByRole("navigation");
  const footerNav = page.getByRole("contentinfo").getByRole("navigation");
  await expect(page.getByRole("link", { name: "ClauseClear" })).toBeVisible();
  await expect(hiButton(page)).toBeVisible();
  if (width < 640) {
    await expect(headerNav).toBeHidden();
    await expect(footerNav).toBeVisible();
    await expect(footerNav.getByRole("link", { name: "Checklist" })).toBeVisible();
  } else {
    await expect(headerNav).toBeVisible();
    await expect(footerNav).toBeHidden();
  }
  // Exactly one nav is in the accessibility tree at any width.
  await expect(page.getByRole("navigation")).toHaveCount(1);
  // Nothing may overflow the header horizontally.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("header screenshots in English and Hindi", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const header = page.getByRole("banner");
  const name = testInfo.project.name;
  await header.screenshot({ path: `audit/screens/header-${name}.png` });

  await hiButton(page).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await page.evaluate(() => document.fonts.ready);
  await header.screenshot({ path: `audit/screens/header-${name}-hi.png` });
});
