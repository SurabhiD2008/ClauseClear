import path from "node:path";
import { expect, test, type Page, type TestInfo } from "./guard.js";

// One full-page screenshot per page and state for each project (SPEC section
// 12), saved as audit/screens/pages/<page>-<project>.png so a failure can be
// pointed at by file name. The guard checks each of these pages as well.
const ROOT = process.cwd();

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

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  const file = path.join(ROOT, "audit", "screens", "pages", `${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
}

async function paste(page: Page) {
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Paste the text of your document").fill(LEASE);
  await page.getByRole("button", { name: "Check this text" }).click();
}

test("landing", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shoot(page, testInfo, "landing");
});

test("landing while a run is loading", async ({ page }, testInfo) => {
  await page.route("**/api/analyze", () => new Promise<void>(() => undefined));
  await page.goto("/");
  await paste(page);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await shoot(page, testInfo, "loading");
});

test("landing with an error", async ({ page, guard }, testInfo) => {
  guard.expectStatus(/\/api\/analyze$/, 503);
  await page.route("**/api/analyze", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "PROVIDER_UNAVAILABLE", message: "stub" }),
    }),
  );
  await page.goto("/");
  await paste(page);
  await expect(page.locator('[data-error-code="PROVIDER_UNAVAILABLE"]')).toBeVisible();
  await shoot(page, testInfo, "error");
});

test("results of a sample", async ({ page }, testInfo) => {
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await shoot(page, testInfo, "results");
});

test("results in Hindi", async ({ page }, testInfo) => {
  await page.goto("/results/sample/rental");
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("What this says");
  await shoot(page, testInfo, "results-hi");
});

test("results of a run", async ({ page }, testInfo) => {
  await page.goto("/");
  await paste(page);
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await shoot(page, testInfo, "results-run");
});

test("checklist", async ({ page }, testInfo) => {
  await page.goto("/results/sample/rental");
  await page.getByRole("link", { name: /before-and-after checklist/ }).click();
  await expect(page).toHaveURL(/\/checklist$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shoot(page, testInfo, "checklist");
});

test("not found", async ({ page }, testInfo) => {
  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await shoot(page, testInfo, "not-found");
});
