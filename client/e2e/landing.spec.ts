import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "./guard.js";

// Prompt 11: the landing page against the mock provider (playwright.config.ts runs
// MOCK_SCENARIO=slow, so every run takes about 1.5 s). Messages are read from
// en.json and filled in here, so a copy change cannot leave a test asserting old text.
const ROOT = process.cwd();
const DOCS = path.join(ROOT, "fixtures", "docs");
const en = JSON.parse(readFileSync(path.join(ROOT, "client/src/i18n/en.json"), "utf8")) as {
  errors: Record<string, string>;
  errorUi: Record<string, string>;
  landing: Record<string, string>;
};

// The limits as the UI prints them (SPEC section 4); kept local like language.spec.ts.
const VARS: Record<string, string> = { mb: "10", pages: "25", min: "200", max: "60,000" };

function message(code: string, extra: Record<string, string> = {}): string {
  const vars = { ...VARS, ...extra };
  return (en.errors[code] ?? "").replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}

const LEASE = [
  "LEAVE AND LICENSE AGREEMENT FOR A FLAT IN PUNE",
  "",
  "1. The licensee shall pay a monthly licence fee of Rs. 25,000 on the fifth day of each month.",
  "",
  "2. The licensor may enter the premises at any time without notice to inspect them.",
  "",
  "3. If the licensee leaves before the lock-in ends, the licensee shall forfeit the whole deposit.",
].join("\n");

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

async function pasteText(page: Page, text: string) {
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Paste the text of your document").fill(text);
  await page.getByRole("button", { name: "Check this text" }).click();
}

function onlyOn(testInfo: TestInfo, project: string) {
  test.skip(testInfo.project.name !== project, `layout sweep runs once, on ${project}`);
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
    ["FILE_TOO_LARGE", "over-10mb.pdf"],
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

test("no horizontal scroll from 320 to 1920 px", async ({ page }, testInfo) => {
  onlyOn(testInfo, "desktop");
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
