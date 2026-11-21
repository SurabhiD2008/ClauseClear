// Shared by the landing-page specs: the English messages as the UI prints them
// and the paste-text steps. Messages are read from
// en.json and filled in here, so a copy change cannot leave a test asserting old text.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "../guard.js";
import { ROOT } from "./data.js";

export const en = JSON.parse(readFileSync(path.join(ROOT, "client/src/i18n/en.json"), "utf8")) as {
  errors: Record<string, string>;
  errorUi: Record<string, string>;
  landing: Record<string, string>;
};

// The limits as the UI prints them; kept local like language.spec.ts.
export const VARS: Record<string, string> = { mb: "10", pages: "25", min: "200", max: "60,000" };

export function message(code: string, extra: Record<string, string> = {}): string {
  const vars = { ...VARS, ...extra };
  return (en.errors[code] ?? "").replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}

export async function pasteText(page: Page, text: string) {
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Paste the text of your document").fill(text);
  await page.getByRole("button", { name: "Check this text" }).click();
}
