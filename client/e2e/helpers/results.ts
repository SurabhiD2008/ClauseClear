// Locators and steps shared by the results-page specs.
import type { Flag } from "@clauseclear/shared";
import { expect, type Page } from "../guard.js";

export const flagButton = (page: Page, flag: Flag) =>
  page.locator(`[data-flag-id="${flag.id}"] .cc-flag__head`);
export const viewer = (page: Page) => page.getByTestId("document-viewer");
export const width = (page: Page) => page.viewportSize()?.width ?? 0;
export const sheet = (page: Page) => page.locator("dialog.cc-sheet-dialog[open]");

/** Below 640 px the list starts with three flags; this shows the rest. */
export async function expandAll(page: Page) {
  const more = page.getByRole("button", { name: /^See \d+ more flags$/ });
  if (await more.isVisible()) await more.click();
}

/** Below 1024 px selecting a flag with a clause opens the sheet; Esc closes it again. */
export async function closeSheet(page: Page) {
  if ((await sheet(page).count()) === 0) return;
  // The pointer is still where the flag was clicked, which can now be over a
  // glossary term in the sheet; its hover note would take the first Esc.
  await page.mouse.move(0, 0);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
}
