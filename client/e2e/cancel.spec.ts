import { expect, test } from "./guard.js";

// The mock provider titles a result with the document's first segment, so each
// run's result names the text it came from. The server runs MOCK_SCENARIO=slow
// (playwright.config.ts), so the first run is still in flight when it is cancelled.
const FIRST = [
  "FIRST RUN LEAVE AND LICENSE AGREEMENT",
  "",
  "1. The licensee shall pay a monthly licence fee of Rs. 25,000 on the fifth day of each month.",
  "",
  "2. The licensor may enter the premises at any time without notice to inspect them.",
  "",
  "3. If the licensee leaves before the lock-in ends, the licensee shall forfeit the whole deposit.",
].join("\n");

const SECOND = [
  "SECOND RUN EMPLOYMENT OFFER LETTER",
  "",
  "1. The employee shall serve a notice period of ninety days, which the company may extend at its sole discretion.",
  "",
  "2. For two years after leaving, the employee shall not join any competitor of the company anywhere.",
  "",
  "3. The company may recover training costs from the final salary if the employee resigns within two years.",
].join("\n");

test("start a run, cancel it, start another: only the second result appears", async ({ page }) => {
  const analyzeCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/analyze")) analyzeCalls.push(request.postData() ?? "");
  });

  await page.goto("/");
  const openPaste = page.getByRole("button", { name: "Paste text", exact: true });
  const textbox = page.getByLabel("Paste the text of your document");
  const check = page.getByRole("button", { name: "Check this text" });
  const cancel = page.getByRole("button", { name: "Cancel" });

  await openPaste.click();
  await textbox.fill(FIRST);
  await check.click();
  await expect(cancel).toBeVisible();
  // Double-submit guard: while the run is active the upload controls are replaced
  // by the loading view, so nothing can start a second run.
  await expect(openPaste).toBeHidden();
  await expect(page.getByRole("button", { name: "Choose a PDF" })).toBeHidden();
  await cancel.click();
  await expect(page.getByText("Stopped. Nothing was kept. You can start again.")).toBeVisible();
  await expect(cancel).toBeHidden();
  await expect(page).toHaveURL(/\/$/);

  await openPaste.click();
  await textbox.fill(SECOND);
  await check.click();
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  const heading = page.locator(".cc-results__name");
  await expect(heading).toHaveText(/^SECOND RUN EMPLOYMENT OFFER LETTER/);

  // Wait past the first run's own finishing time; its result must never replace this one.
  await page.waitForTimeout(2_000);
  await expect(heading).toHaveText(/^SECOND RUN EMPLOYMENT OFFER LETTER/);
  await expect(page.getByText("FIRST RUN", { exact: false })).toHaveCount(0);

  expect(analyzeCalls).toHaveLength(2);
  expect(analyzeCalls[0]).toContain("FIRST RUN");
  expect(analyzeCalls[1]).toContain("SECOND RUN");
});

test("refreshing /results goes home with the not-stored note", async ({ page }) => {
  await page.goto("/results");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText(
      "Your result isn’t stored, so it can’t be reopened. Upload again or try a sample.",
    ),
  ).toBeVisible();
});
