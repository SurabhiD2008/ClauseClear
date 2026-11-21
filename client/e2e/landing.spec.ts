import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import { en, message, pasteText } from "./helpers/landing.js";
import { DOCS, LEASE } from "./helpers/data.js";

// The landing page against the mock provider (playwright.config.ts runs
// MOCK_SCENARIO=slow, so every run takes about 1.5 s). Messages are read from
// en.json and filled in here, so a copy change cannot leave a test asserting old text.

/**
 * A file one KiB over the 10 MB upload limit, built in memory so the suite needs
 * no generated fixture. It starts like a PDF, so only its size is wrong.
 */
const OVERSIZE_PDF = {
  name: "over-10mb.pdf",
  buffer: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(10 * 1024 * 1024 + 1024)]),
};

function analyzeCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/analyze")) calls.push(request.method());
  });
  return calls;
}

async function choosePdf(page: Page, file: string | { name: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a PDF" }).click();
  await (
    await chooser
  ).setFiles(
    typeof file === "string"
      ? path.join(DOCS, file)
      : { name: file.name, mimeType: "application/pdf", buffer: file.buffer },
  );
}

test("upload happy path: a PDF goes through the loading view to /results", async ({ page }) => {
  await page.goto("/");
  await choosePdf(page, "rental.pdf");

  const steps = page.getByRole("list", { name: "Progress" });
  await expect(page.getByText(en.landing.loadingTitle ?? "")).toBeVisible();
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();

  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("paste text: the dialog counts characters and starts a run", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paste the text" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("0 of 60,000 characters")).toBeVisible();

  await dialog.getByLabel("Paste the text of your document").fill(LEASE);
  const counted = LEASE.trim().length.toLocaleString("en-US");
  await expect(dialog.getByText(`${counted} of 60,000 characters`)).toBeVisible();
  await dialog.getByRole("button", { name: "Check this text" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await expect(page.locator(".cc-results__name")).toHaveText(/^LEAVE AND LICENSE AGREEMENT/);
});

test("Esc closes the paste dialog and focus returns to its button", async ({ page }) => {
  await page.goto("/");
  const open = page.getByRole("button", { name: "Paste text", exact: true });
  await open.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(open).toBeFocused();
});

test("a sample link opens that sample with no analysis call", async ({ page }) => {
  const calls = analyzeCalls(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Job offer" }).click();
  await expect(page).toHaveURL(/\/results\/sample\/job-offer$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(calls).toHaveLength(0);
});

test("keyboard only: Tab to Choose a PDF, Enter opens the file input", async ({ page }) => {
  await page.goto("/");
  // Listen first: file-chooser interception is set up asynchronously, and a bare
  // Enter press is fast enough to beat it.
  const chooser = page.waitForEvent("filechooser");
  const order: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return (el?.getAttribute("aria-label") ?? el?.textContent ?? "").trim();
    });
    order.push(name);
    if (name === "Choose a PDF") break;
  }
  // The skip link, then the header, then the upload area's first control.
  expect(order[0]).toBe("Skip to content");
  expect(order.at(-1)).toBe("Choose a PDF");
  expect(order.length).toBeLessThan(10);

  await page.keyboard.press("Enter");
  await (await chooser).setFiles(path.join(DOCS, "rental.pdf"));
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
});

test("the landing tab order follows the page: upload, notices' samples, sections", async ({
  page,
}) => {
  await page.goto("/");
  const seen: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => document.activeElement?.textContent.trim() ?? ""));
  }
  const at = (label: string) => seen.indexOf(label);
  const expected = [
    "Choose a PDF",
    "Paste text",
    "Rental agreement",
    "Job offer",
    "Loan agreement",
    "Open the sample checklist →",
    "indemnify",
  ];
  for (const label of expected) expect(at(label), label).toBeGreaterThan(-1);
  const positions = expected.map(at);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

test.describe("every error code shows its message", () => {
  // Caught in the browser first; the server would reject them the same way.
  const clientFiles: [string, string | { name: string; buffer: Buffer }][] = [
    ["NOT_PDF", "text-renamed.pdf"],
    ["FILE_TOO_LARGE", OVERSIZE_PDF],
    ["BAD_REQUEST", "empty.pdf"],
  ];
  for (const [code, file] of clientFiles) {
    test(`${code} (client check, no request sent)`, async ({ page }) => {
      const calls = analyzeCalls(page);
      await page.goto("/");
      await choosePdf(page, file);
      const strip = page.locator(`[role="alert"][data-error-code="${code}"]`);
      await expect(strip).toContainText(message(code));
      await expect(strip).toContainText(en.errorUi.stamp ?? "");
      await expect(page.locator(".cc-hero__error")).toBeFocused();
      await expect(strip.getByRole("button", { name: "Paste text instead" })).toBeVisible();
      expect(calls).toHaveLength(0);
    });
  }

  // These pass the client checks (they start with %PDF) and the real server rejects them.
  for (const [code, file] of [
    ["PDF_ENCRYPTED", "encrypted.pdf"],
    ["TOO_MANY_PAGES", "over-25-pages.pdf"],
    ["NO_TEXT", "scan-no-text.pdf"],
  ] as const) {
    test(`${code} (server check)`, async ({ page, guard }) => {
      guard.expectStatus(/\/api\/analyze$/);
      const calls = analyzeCalls(page);
      await page.goto("/");
      await choosePdf(page, file);
      await expect(page.locator(`[role="alert"][data-error-code="${code}"]`)).toContainText(
        message(code),
      );
      expect(calls).toHaveLength(1);
    });
  }

  const pasted: [string, string][] = [
    ["TEXT_TOO_SHORT", "Too short to be a contract."],
    ["TEXT_TOO_LONG", "a ".repeat(30_001)],
    ["NOT_ENGLISH", `${LEASE}\n4. किराया हर महीने की पाँच तारीख को देना होगा।`],
  ];
  for (const [code, text] of pasted) {
    test(`${code} (paste dialog, inline)`, async ({ page }) => {
      const calls = analyzeCalls(page);
      await page.goto("/");
      await pasteText(page, text);
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator(`[data-error-code="${code}"]`)).toHaveText(message(code));
      await expect(dialog.getByText(/of 60,000 characters/)).toBeVisible();
      expect(calls).toHaveLength(0);
    });
  }

  // Codes only a model or the limiter produces, so the response is stubbed.
  const stubbed: [string, number, Record<string, unknown>, Record<string, string>][] = [
    ["NOT_LEGAL", 422, {}, {}],
    ["RATE_LIMITED", 429, { retryAfterSec: 30 }, { n: "30" }],
    ["PROVIDER_UNAVAILABLE", 503, {}, {}],
  ];
  for (const [code, status, extra, vars] of stubbed) {
    test(`${code} (stubbed HTTP ${String(status)})`, async ({ page, guard }) => {
      guard.expectStatus(/\/api\/analyze$/, status);
      await page.route("**/api/analyze", (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ code, message: "stub", ...extra }),
        }),
      );
      await page.goto("/");
      await pasteText(page, LEASE);
      const strip = page.locator(`[role="alert"][data-error-code="${code}"]`);
      await expect(strip).toContainText(message(code, vars));
      if (code === "RATE_LIMITED") {
        await expect(strip.getByRole("button", { name: /^Try again in \d+ s$/ })).toBeDisabled();
      }
      if (code !== "NOT_LEGAL") {
        await expect(strip.getByRole("link", { name: "Open a sample" })).toBeVisible();
      }
    });
  }

  test("ANALYSIS_FAILED (stubbed SSE error event mid-stream), and Try again re-runs", async ({
    page,
  }) => {
    let calls = 0;
    await page.route("**/api/analyze", (route) => {
      calls += 1;
      if (calls > 1) return route.continue();
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body:
          'event: status\ndata: {"step":"reading"}\n\n' +
          'event: error\ndata: {"code":"ANALYSIS_FAILED","message":"stub"}\n\n',
      });
    });
    await page.goto("/");
    await pasteText(page, LEASE);
    const strip = page.locator('[role="alert"][data-error-code="ANALYSIS_FAILED"]');
    await expect(strip).toContainText(message("ANALYSIS_FAILED"));
    await strip.getByRole("button", { name: "Try again" }).click();
    await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
    expect(calls).toBe(2);
  });

  test("NOT_FOUND (a sample that does not exist)", async ({ page, guard }) => {
    guard.expectStatus(/\/api\/samples\/nope$/, 404);
    await page.goto("/results/sample/nope");
    const strip = page.locator('[role="alert"][data-error-code="NOT_FOUND"]');
    await expect(strip).toContainText(message("NOT_FOUND"));
    await expect(strip.getByRole("link", { name: "Open a sample" })).toBeVisible();
  });
});
