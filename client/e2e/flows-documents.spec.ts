import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import { choosePdf, phoneLayout, streamedResult } from "./helpers/flows.js";
import { SCENARIO_SERVERS } from "../../playwright.config.js";
import { DEVANAGARI, LEASE, ROOT, rental } from "./helpers/data.js";

// Documents that test the reading itself (a prompt injection, symbols and
// Devanagari) and how the app behaves when providers fail or are rate limited.
const en = JSON.parse(readFileSync(path.join(ROOT, "client/src/i18n/en.json"), "utf8")) as {
  errors: Record<string, string>;
  landing: Record<string, string>;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The English message for a code, with every {placeholder} matching any number. */
const messagePattern = (code: string) =>
  new RegExp(
    escape(en.errors[code] ?? "")
      .replace(/\\\{(?:mb|pages)\\\}/g, "\\d+")
      .replace(/\\\{n\\\}/g, "\\d+"),
  );
async function pasteText(page: Page, text: string) {
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Paste the text of your document").fill(text);
  await page.getByRole("button", { name: "Check this text" }).click();
}

// Smooth scrolling moves buttons mid-click (results.spec.ts covers motion).
test.use({ reducedMotion: "reduce" });

test("the prompt-injection document is read as data", async ({ page }) => {
  await page.goto("/");
  const result = await streamedResult(page, () => choosePdf(page, "injection.pdf"));
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  // The instruction is part of the user's document, kept as text...
  expect(result.segments.some((s) => s.text.includes("Ignore all previous instructions"))).toBe(
    true,
  );
  // ...and it changed nothing: the risky clauses are still flagged and scored.
  expect(result.flags.filter((f) => f.kind === "present").length).toBeGreaterThan(0);
  expect(result.score.value).toBeGreaterThan(0);
  await expect(page.locator("[data-score]")).toHaveAttribute(
    "data-score",
    String(result.score.value),
  );
  await expect(page.locator(".cc-verdict")).not.toContainText("ALL CLEAR");
  await expect(page.locator(".cc-verdict__summary")).not.toContainText(/no risks/i);
});

test("a document with symbols and Devanagari ends in NOT_ENGLISH, with an English page", async ({
  page,
  guard,
}) => {
  // Devanagari input is refused on the server. The guard's language check
  // then runs on an English page and must find nothing.
  guard.expectStatus(/\/api\/analyze$/, 422);
  await page.goto("/");
  await choosePdf(page, "symbols-devanagari.pdf");
  const strip = page.locator('[role="alert"][data-error-code="NOT_ENGLISH"]');
  await expect(strip).toContainText(messagePattern("NOT_ENGLISH"));
  await expect(strip.getByRole("button", { name: "Paste text instead" })).toBeVisible();
  expect(DEVANAGARI.test(await page.locator("body").innerText())).toBe(false);
});

test("Devanagari inside the document viewer does not fail the language check", async ({
  page,
  guard,
}) => {
  // The server never lets this through; a stubbed result puts it in the
  // viewer anyway, to prove the guard's document exemption is not a false failure.
  const segments = rental.segments.map((s, i) =>
    i === rental.segments.length - 1 ? { ...s, text: `${s.text} किराया ₹25,000 § 4 © ½` } : s,
  );
  await page.route("**/api/analyze", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `event: status\ndata: {"step":"reading"}\n\nevent: result\ndata: ${JSON.stringify({ ...rental, segments })}\n\n`,
    }),
  );
  await page.goto("/");
  await pasteText(page, LEASE);
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  if (!phoneLayout(page)) {
    await expect(page.getByTestId("document-viewer")).toContainText("किराया");
  }
  // Only the language check is this test's subject; the guard still runs every
  // check, this one included, when the test ends.
  expect((await guard.collect()).filter((v) => v.check === "language")).toEqual([]);
});

test.describe("provider behaviour on the scenario servers", () => {
  test.describe("a 429, then the second provider answers slowly", () => {
    test.use({ baseURL: `http://127.0.0.1:${String(SCENARIO_SERVERS.fallback)}` });

    test("the run still ends in a result", async ({ page }) => {
      await page.goto("/");
      await pasteText(page, LEASE);
      await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
      await expect(page).toHaveURL(/\/results$/, { timeout: 20_000 });
      await expect(page.locator(".cc-results__name")).toHaveText(/^LEAVE AND LICENSE AGREEMENT/);
    });

    test("a slow provider shows the 20 s line, then the result", async ({ page }) => {
      await page.clock.install();
      await page.goto("/");
      await pasteText(page, LEASE);
      await page.clock.runFor(100);
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(page.getByText(en.landing.slow ?? "")).toBeHidden();
      await page.clock.fastForward(20_000);
      await expect(page.getByText(en.landing.slow ?? "")).toBeVisible();
      await page.clock.resume();
      await expect(page).toHaveURL(/\/results$/, { timeout: 20_000 });
    });
  });

  for (const [name, port, code] of [
    ["every provider rate limited", SCENARIO_SERVERS.rateLimited, "RATE_LIMITED"],
    ["every provider failing", SCENARIO_SERVERS.unavailable, "PROVIDER_UNAVAILABLE"],
  ] as const) {
    test.describe(name, () => {
      test.use({ baseURL: `http://127.0.0.1:${String(port)}` });

      test(`shows the ${code} copy and offers a sample`, async ({ page, guard }) => {
        test.setTimeout(60_000);
        // Before the stream starts the code is an HTTP status; after, an SSE event.
        guard.expectStatus(/\/api\/analyze$/);
        await page.goto("/");
        await pasteText(page, LEASE);
        const strip = page.locator(`[role="alert"][data-error-code="${code}"]`);
        await expect(strip).toContainText(messagePattern(code), { timeout: 40_000 });
        await expect(strip.getByRole("link", { name: "Open a sample" })).toBeVisible();
        // The link leads to the samples on the landing page, which cost no AI call.
        await strip.getByRole("link", { name: "Open a sample" }).click();
        await expect(page).toHaveURL(/\/#samples$/);
        await expect(page.getByRole("link", { name: "Rental agreement" })).toBeInViewport();
      });
    });
  }
});
