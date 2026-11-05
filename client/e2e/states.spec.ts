import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import type { AnalysisResult } from "../../shared/src/schemas.js";

// Prompt 15: the remaining states (SPEC F16, F19, section 9): not found, the
// redirect note, translation failure, offline, error copy in Hindi, print,
// loading and translating without layout shift, and the type override.
const ROOT = process.cwd();
const read = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as unknown;
const en = read("client/src/i18n/en.json") as Record<string, Record<string, string>>;
const hi = read("client/src/i18n/hi.json") as Record<string, Record<string, string>>;
const rental = (read("fixtures/samples/rental.json") as { en: AnalysisResult }).en;

test.use({ reducedMotion: "reduce" });

const LEASE = [
  "LEAVE AND LICENSE AGREEMENT FOR A FLAT IN PUNE",
  "",
  "1. The licensee shall pay a monthly licence fee of Rs. 25,000 on the fifth day of each month.",
  "",
  "2. The licensor may enter the premises at any time without notice to inspect them.",
  "",
  "3. If the licensee leaves before the lock-in ends, the licensee shall forfeit the whole deposit.",
].join("\n");

async function pasteText(page: Page, text: string) {
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Paste the text of your document").fill(text);
  await page.getByRole("button", { name: "Check this text" }).click();
}

/** A finished run (not a sample), so the type select and live translation apply. */
async function runToResults(page: Page) {
  await page.goto("/");
  await pasteText(page, LEASE);
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
}

const top = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

test("an unknown address shows the not-found page, in English and in Hindi", async ({ page }) => {
  await page.goto("/no/such/page");
  const heading = page.getByRole("heading", { level: 1, name: en.notFound?.h1 ?? "" });
  await expect(heading).toBeFocused();
  await expect(page.locator(".cc-notfound .cc-stamp")).toHaveText(en.notFound?.stamp ?? "");
  await expect(page.getByRole("link", { name: en.notFound?.home ?? "" })).toHaveAttribute(
    "href",
    "/",
  );
  await page.getByRole("link", { name: en.notFound?.sample ?? "" }).click();
  await expect(page).toHaveURL(/\/#samples$/);

  await page.goto("/no/such/page");
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(hi.notFound?.h1 ?? "");
  await expect(page.locator(".cc-notfound")).toContainText(hi.notFound?.body ?? "");
});

test("results and checklist without data go home with the not-stored note", async ({ page }) => {
  for (const route of ["/results", "/checklist"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("status").filter({ hasText: en.landing?.resultGone ?? "" }),
    ).toBeVisible();
  }
});

test("error copy and next step in Hindi: too short, and not a PDF", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await page.getByRole("button", { name: hi.landing?.pasteText ?? "", exact: true }).click();
  await page.getByLabel(hi.landing?.pasteLabel ?? "").fill("Too short.");
  await page.getByRole("button", { name: hi.landing?.analyzeText ?? "" }).click();
  const short = page.locator('[role="alert"][data-error-code="TEXT_TOO_SHORT"]');
  await expect(short).toContainText((hi.errors?.TEXT_TOO_SHORT ?? "").replace("{min}", "200"));
  await page.keyboard.press("Escape");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: hi.landing?.choosePdf ?? "" }).click();
  await (
    await chooser
  ).setFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("just some text, not a PDF"),
  });
  const notPdf = page.locator('[role="alert"][data-error-code="NOT_PDF"]');
  await expect(notPdf).toContainText(hi.errors?.NOT_PDF ?? "");
});

test("a provider failure in Hindi: the copy, a retry and a sample to try", async ({
  page,
  guard,
}) => {
  guard.expectStatus(/\/api\/analyze$/, 503);
  await page.route("**/api/analyze", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "PROVIDER_UNAVAILABLE", message: "down" }),
    }),
  );
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  await page.getByRole("button", { name: hi.landing?.pasteText ?? "", exact: true }).click();
  await page.getByLabel(hi.landing?.pasteLabel ?? "").fill(LEASE);
  await page.getByRole("button", { name: hi.landing?.analyzeText ?? "" }).click();
  const strip = page.locator('[role="alert"][data-error-code="PROVIDER_UNAVAILABLE"]');
  await expect(strip).toContainText(hi.errors?.PROVIDER_UNAVAILABLE ?? "");
  await expect(strip.getByRole("button", { name: hi.errorUi?.retry ?? "" })).toBeVisible();
  await expect(strip.getByRole("link", { name: hi.errorUi?.trySample ?? "" })).toBeVisible();
});

test("translation failure shows a notice in the status bar and moves nothing", async ({
  page,
  guard,
}) => {
  guard.expectStatus(/\/api\/translate$/, 503);
  await page.route("**/api/translate", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "PROVIDER_UNAVAILABLE", message: "down" }),
    }),
  );
  await runToResults(page);
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  const notice = page.locator('[data-notice="translate-failed"]');
  await expect(notice).toHaveText(hi.results?.translateFailed ?? "");
  await expect(page.getByRole("alert").filter({ has: notice })).toHaveCount(1);
  // The status bar is fixed, outside the page's flow: taking it away moves nothing.
  const bar = page.getByTestId("status-bar");
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  const withNotice = await top(page, ".cc-verdict");
  await bar.evaluate((el) => {
    el.style.display = "none";
  });
  expect(await top(page, ".cc-verdict")).toBe(withNotice);
});

test("translating shows a notice without moving the page", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/translate", async (route) => {
    await held;
    await route.fallback();
  });
  await runToResults(page);
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  const notice = page.locator('[data-notice="translating"]');
  await expect(notice).toHaveText(hi.results?.translating ?? "");
  // Measured with the notice up and again once it has gone: the same place.
  // (Switching language itself rewraps the interface text above, so the
  // comparison is within Hindi.)
  const withNotice = await top(page, ".cc-verdict");
  release();
  await expect(notice).toHaveCount(0);
  expect(await top(page, ".cc-verdict")).toBe(withNotice);
});

test("offline shows a notice, and it goes when the connection is back", async ({
  page,
  context,
}) => {
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  const before = await top(page, ".cc-verdict");
  await context.setOffline(true);
  const notice = page.locator('[data-notice="offline"]');
  await expect(notice).toHaveText(en.status?.offline ?? "");
  await expect(page.getByRole("status").filter({ has: notice })).toHaveCount(1);
  expect(await top(page, ".cc-verdict")).toBe(before);
  await context.setOffline(false);
  await expect(notice).toHaveCount(0);
});

test("loading keeps the upload box's size, including the 20 s line", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/analyze", () => new Promise<void>(() => undefined));
  await page.goto("/");
  const box = page.locator(".cc-upload");
  const below = ".cc-hero__small";
  const idle = await box.boundingBox();
  const belowIdle = await top(page, below);
  await pasteText(page, LEASE);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  const loading = await box.boundingBox();
  expect(loading?.height).toBe(idle?.height);
  expect(await top(page, below)).toBe(belowIdle);
  await page.clock.fastForward(20_000);
  await expect(page.getByText(en.landing?.slow ?? "")).toBeVisible();
  expect((await box.boundingBox())?.height).toBe(idle?.height);
  expect(await top(page, below)).toBe(belowIdle);
});

test("print: A4, no sticky panel or buttons, every flag open with its quote", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await page.getByRole("button", { name: "Save report" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  if (wide) await expect(page.locator(".cc-results__aside")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  // The sticky document panel and the sheet are gone, and so are the buttons.
  await expect(page.locator(".cc-results__aside")).toBeHidden();
  await expect(page.locator("dialog.cc-sheet-dialog")).toBeHidden();
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("button", { name: "Save report" })).toBeHidden();
  await expect(page.locator(".cc-filter")).toBeHidden();
  // Every flag is on the page and open; every present flag keeps its quote.
  await expect(page.locator(".cc-flag")).toHaveCount(rental.flags.length);
  await expect(page.locator(".cc-flag__body:visible")).toHaveCount(rental.flags.length);
  const present = rental.flags.filter((flag) => flag.kind === "present");
  await expect(page.locator(".cc-quote__text:visible")).toHaveCount(present.length);
  const breaks = await page
    .locator(".cc-flag")
    .first()
    .evaluate((el) => getComputedStyle(el).breakInside);
  expect(breaks).toBe("avoid");
  const ink = await page.locator("body").evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.color, s.backgroundColor];
  });
  expect(ink).toEqual(["rgb(0, 0, 0)", "rgb(255, 255, 255)"]);

  // The @page rule makes the printed paper A4 (595 x 842 points).
  if (testInfo.project.name === "desktop") {
    const pdf = await page.pdf({ preferCSSPageSize: true });
    const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
    expect(box).not.toBeNull();
    expect(Math.round(Number(box?.[1]))).toBe(595);
    expect(Math.round(Number(box?.[2]))).toBe(842);
  }
});

test("Not right? Change it: runs the document again with the chosen type", async ({ page }) => {
  await runToResults(page);
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/analyze")) bodies.push(request.postData() ?? "");
  });
  const toggle = page.getByRole("button", { name: en.results?.changeType ?? "" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel(en.results?.typeLabel ?? "").selectOption("loan");
  await expect(page.getByText(en.results?.rerunNote ?? "")).toBeVisible();
  await page.getByRole("button", { name: en.results?.rerun ?? "" }).click();
  // The landing page shows the run, then the new result opens.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({ text: LEASE, docType: "loan" });
  await expect(page.locator(".cc-verdict__detected")).toContainText(/loan/i);
});

test("samples have no type select: there is no input to run again", async ({ page }) => {
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await expect(page.getByRole("button", { name: en.results?.changeType ?? "" })).toHaveCount(0);
});
