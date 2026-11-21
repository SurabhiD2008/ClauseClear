import { expect, test, type Page } from "./guard.js";
import { closeSheet, expandAll, flagButton, sheet, viewer, width } from "./helpers/results.js";
import type { AnalysisResult, Flag } from "../../shared/src/schemas.js";
import { computeScore } from "../../shared/src/scoring.js";
import { rental } from "./helpers/data.js";

// The results page on the mock provider and the sample route. The
// rental sample is the fixture the server serves at /results/sample/rental.

/** Ranked as the page ranks them: high, then medium, then missing. */
function ranked(flags: readonly Flag[]): Flag[] {
  const rank = (f: Flag) => (f.kind === "missing" ? 2 : f.severity === "high" ? 0 : 1);
  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.i - b.i)
    .map(({ flag }) => flag);
}

/** A valid result with only the flags kept, every reference to the others removed, and the score recomputed. */
function withFlags(
  base: AnalysisResult,
  keep: (flag: Flag) => boolean,
  warnings: AnalysisResult["warnings"] = [],
): AnalysisResult {
  const flags = base.flags.filter(keep);
  const ids = new Set(flags.map((f) => f.id));
  const scrub = <T extends { flagIds: string[] }>(items: T[]) =>
    items.map((item) => ({ ...item, flagIds: item.flagIds.filter((id) => ids.has(id)) }));
  return {
    ...base,
    flags,
    clauses: base.clauses.map(({ flagId, ...clause }) =>
      flagId !== undefined && ids.has(flagId) ? { ...clause, flagId } : clause,
    ),
    questions: scrub(base.questions),
    checklist: { before: scrub(base.checklist.before), after: scrub(base.checklist.after) },
    score: computeScore(flags),
    warnings,
  };
}

const PASTE = [
  "LEAVE AND LICENSE AGREEMENT FOR A FLAT IN PUNE",
  "",
  "1. The licensee shall pay a monthly licence fee of Rs. 25,000 on the fifth day of each month.",
  "",
  "2. The licensor may enter the premises at any time without notice to inspect them.",
  "",
  "3. If the licensee leaves before the lock-in ends, the licensee shall forfeit the whole deposit.",
].join("\n");

/** Runs an analysis whose result is the given one, through the real client and SSE parser. */
async function showResult(page: Page, result: AnalysisResult) {
  await page.route("**/api/analyze", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `event: status\ndata: {"step":"reading"}\n\nevent: result\ndata: ${JSON.stringify(result)}\n\n`,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Paste the text of your document").fill(PASTE);
  await page.getByRole("button", { name: "Check this text" }).click();
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
}

// The page scrolls smoothly unless reduced motion is on, and a smooth scroll moves
// a button after Playwright has measured where to click it. The motion test below
// covers both settings.
test.use({ reducedMotion: "reduce" });

test("Copy and Copy all put the questions on the clipboard and announce it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/results/sample/rental");
  const status = page.getByTestId("copy-status");
  await expect(status).toHaveAttribute("aria-live", "polite");

  await page.getByRole("button", { name: "Copy question 2" }).click();
  await expect(status).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(rental.questions[1]?.text);

  await page.getByRole("button", { name: "Copy all" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  // The Windows clipboard stores line breaks as CRLF.
  const all = await page.evaluate(() => navigator.clipboard.readText());
  expect(all.replace(/\r\n/g, "\n")).toBe(
    rental.questions.map((q, i) => `${String(i + 1)}. ${q.text}`).join("\n"),
  );
});

test("Copy falls back to a textarea when the Clipboard API refuses", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- stubbing the fallback the page uses
    document.execCommand = (command: string) => {
      const active = document.activeElement;
      if (command === "copy" && active instanceof HTMLTextAreaElement) copied.push(active.value);
      return command === "copy";
    };
  });
  await page.goto("/results/sample/rental");
  const copyButton = page.getByRole("button", { name: "Copy question 1" });
  await copyButton.click();
  await expect(page.getByTestId("copy-status")).toHaveText("Copied");
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual(
    [rental.questions[0]?.text],
  );
  // Focus goes back to the button, and the textarea is gone.
  await expect(copyButton).toBeFocused();
  await expect(page.locator("body > textarea")).toHaveCount(0);
});

test("keyboard only: filter, open flags with Enter and Space, copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/results/sample/rental");
  const order = ranked(rental.flags);

  const tabTo = async (selector: string) => {
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press("Tab");
      if (await page.evaluate((sel) => document.activeElement?.matches(sel) === true, selector))
        return;
    }
    throw new Error(`never reached ${selector}`);
  };

  await tabTo(".cc-filter__button:nth-child(2)");
  await page.keyboard.press("Enter");
  const highs = order.filter((f) => f.severity === "high");
  await expect(page.locator(".cc-flag")).toHaveCount(highs.length);

  await tabTo(".cc-filter__button:nth-child(1)");
  await page.keyboard.press("Space");
  // Below 640 px the list starts with three flags (results-mobile.png).
  await expect(page.locator(".cc-flag")).toHaveCount(width(page) < 640 ? 3 : order.length);

  // Tab into the list: the first flag is open (the filter selected it); Space on the second opens it.
  const [first, second] = order;
  if (first === undefined || second === undefined) throw new Error("need two flags");
  await tabTo(`[data-flag-id="${first.id}"] .cc-flag__head`);
  await page.keyboard.press("Enter");
  await expect(flagButton(page, first)).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(flagButton(page, first)).toHaveAttribute("aria-expanded", "true");
  if (width(page) < 1024) {
    // The sheet opened at the clause; Esc closes it and focus is back on the flag.
    await expect(sheet(page)).toHaveCount(1);
    await closeSheet(page);
    await expect(flagButton(page, first)).toBeFocused();
  }
  await tabTo(`[data-flag-id="${second.id}"] .cc-flag__head`);
  await page.keyboard.press("Space");
  await expect(flagButton(page, second)).toHaveAttribute("aria-expanded", "true");
  await expect(viewer(page).locator(`mark[data-flag-id="${second.id}"]`)).toHaveCount(1);
  if (width(page) < 1024) {
    await closeSheet(page);
    await expect(flagButton(page, second)).toBeFocused();
  }

  await tabTo('[aria-label="Copy question 1"]');
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("copy-status")).toHaveText("Copied");

  await tabTo(".cc-results__next a");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/checklist$/);
});

test("refresh on /results goes home with the not-stored note", async ({ page }) => {
  await showResult(
    page,
    withFlags(rental, () => true),
  );
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText(
      "Your result isn’t stored, so it can’t be reopened. Upload again or try a sample.",
    ),
  ).toBeVisible();
});

test("reload on a sample route shows the sample again", async ({ page }) => {
  await page.goto("/results/sample/rental");
  const first = ranked(rental.flags)[0];
  if (first === undefined) throw new Error("no flags");
  await flagButton(page, first).click();
  await page.reload();
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await expandAll(page);
  await expect(page.locator(".cc-flag")).toHaveCount(rental.flags.length);
  await expect(page.locator(".cc-score")).toHaveAttribute(
    "data-score",
    String(computeScore(rental.flags).value),
  );
});

test("glossary terms in a flag open their note on focus and close on Esc", async ({ page }) => {
  await page.goto("/results/sample/rental");
  const first = ranked(rental.flags)[0];
  if (first === undefined) throw new Error("no flags");
  await flagButton(page, first).click();
  await closeSheet(page);
  const term = page.locator(`[data-flag-id="${first.id}"] .cc-term`).first();
  await term.focus();
  const tipId = await term.getAttribute("aria-describedby");
  const tip = page.locator(`[id="${tipId ?? ""}"]`);
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute("role", "tooltip");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  // The note never traps focus: Tab moves on.
  await term.focus();
  await page.keyboard.press("Tab");
  await expect(term).not.toBeFocused();
});
