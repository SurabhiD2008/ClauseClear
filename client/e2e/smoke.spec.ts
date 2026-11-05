import { expect, test } from "./guard.js";

test("landing page has the ClauseClear title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("ClauseClear");
});
