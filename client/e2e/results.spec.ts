import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import { closeSheet, expandAll, flagButton, sheet, viewer, width } from "./helpers/results.js";
import type { AnalysisResult, Flag } from "../../shared/src/schemas.js";
import { computeScore } from "../../shared/src/scoring.js";
import { ROOT, rental } from "./helpers/data.js";

// The results page on the mock provider and the sample route. The
// rental sample is the fixture the server serves at /results/sample/rental.
const en = JSON.parse(readFileSync(path.join(ROOT, "client/src/i18n/en.json"), "utf8")) as {
  results: Record<string, string>;
};

/** Ranked as the page ranks them: high, then medium, then missing. */
function ranked(flags: readonly Flag[]): Flag[] {
  const rank = (f: Flag) => (f.kind === "missing" ? 2 : f.severity === "high" ? 0 : 1);
  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.i - b.i)
    .map(({ flag }) => flag);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

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

test.describe("motion", () => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`the viewer scrolls ${reducedMotion === "reduce" ? "instantly" : "smoothly"} with ${reducedMotion}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const calls: string[] = [];
        (window as unknown as { __scrolls: string[] }).__scrolls = calls;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- called with Reflect.apply and the right this
        const original = Element.prototype.scrollTo;
        Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
          const options = args[0] as ScrollToOptions | undefined;
          if (this.getAttribute("data-testid") === "document-viewer") {
            calls.push(options?.behavior ?? "none");
          }
          Reflect.apply(original, this, args);
        };
      });
      await page.goto(`${test.info().project.use.baseURL ?? ""}/results/sample/rental`);
      const first = ranked(rental.flags)[0];
      await page.locator(`[data-flag-id="${first?.id ?? ""}"] .cc-flag__head`).click();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __scrolls: string[] }).__scrolls))
        .toEqual([reducedMotion === "reduce" ? "auto" : "smooth"]);
      await context.close();
    });
  }
});

test("selecting every flag highlights its own clause and nothing else", async ({ page }) => {
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  const order = ranked(rental.flags);
  await expandAll(page);

  // Flags are numbered in ranked order, so the list matches the fixture.
  await expect(page.locator(".cc-flag")).toHaveCount(order.length);
  expect(
    await page
      .locator(".cc-flag")
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-flag-id"))),
  ).toEqual(order.map((f) => f.id));

  for (const flag of order) {
    await flagButton(page, flag).click();
    await expect(flagButton(page, flag)).toHaveAttribute("aria-expanded", "true");
    // One flag open at a time.
    await expect(page.locator('.cc-flag__head[aria-expanded="true"]')).toHaveCount(1);
    const marks = viewer(page).locator("mark");

    if (flag.kind === "present") {
      // Below 1024 px the viewer is the bottom sheet, opened by the selection.
      if (width(page) < 1024) await expect(sheet(page)).toHaveCount(1);
      await expect(marks).toHaveCount(1);
      const mark = viewer(page).locator(`[data-segment-id="${flag.segmentId ?? ""}"] mark`);
      await expect(mark).toHaveAttribute("data-flag-id", flag.id);
      expect(squash(await mark.innerText())).toBe(squash(flag.quote ?? ""));
      await expect(page.locator(`[data-flag-id="${flag.id}"] .cc-quote__text`)).toHaveAttribute(
        "lang",
        "en",
      );
      await expect(page.locator(`[data-flag-id="${flag.id}"] .cc-found`)).toBeVisible();

      // Desktop: the sticky viewer scrolls itself to the clause.
      if ((page.viewportSize()?.width ?? 0) >= 1024) {
        await expect
          .poll(async () =>
            viewer(page).evaluate((panel, segmentId) => {
              const clause = panel.querySelector(`[data-segment-id="${segmentId}"]`);
              if (clause === null) return false;
              const a = panel.getBoundingClientRect();
              const b = clause.getBoundingClientRect();
              return b.top >= a.top - 1 && b.top < a.bottom;
            }, flag.segmentId),
          )
          .toBe(true);
      }
    } else {
      await expect(marks).toHaveCount(0);
      await expect(page.locator(`[data-flag-id="${flag.id}"] .cc-missing-box`)).toHaveText(
        en.results.docMissing?.replace("{item}", flag.category) ?? "",
      );
      await expect(page.locator(`[data-flag-id="${flag.id}"] .cc-stamp`)).toHaveText(/missing/i);
      // A missing item has no clause, so it never opens the sheet.
      await expect(sheet(page)).toHaveCount(0);
    }
    await closeSheet(page);
  }

  // Selecting the open flag again closes it and removes the mark.
  const last = order.at(-1);
  const first = order[0];
  if (last === undefined || first === undefined) throw new Error("no flags");
  await flagButton(page, first).click();
  await closeSheet(page);
  await flagButton(page, first).click();
  await expect(page.locator('.cc-flag__head[aria-expanded="true"]')).toHaveCount(0);
  await expect(viewer(page).locator("mark")).toHaveCount(0);
  // The viewer and every segment are the user's English text.
  if (width(page) >= 1024) await expect(viewer(page)).toHaveAttribute("lang", "en");
});

test("the score, band and tallies come from the shared scoring function", async ({ page }) => {
  await page.goto("/results/sample/rental");
  const score = computeScore(rental.flags);
  const block = page.locator(".cc-score");
  await expect(block).toHaveAttribute("data-score", String(score.value));
  await expect(block).toHaveAttribute("data-band", score.band);
  await expect(page.locator(".cc-tally--high")).toHaveText(`${String(score.counts.high)} high`);
  await expect(page.locator(".cc-tally--medium")).toHaveText(
    `${String(score.counts.medium)} medium`,
  );
  await expect(page.locator(".cc-tally--missing")).toHaveText(
    `${String(score.counts.missing)} missing`,
  );
  await expect(page.locator(".cc-facts .cc-leader")).toHaveCount(rental.keyFacts.length);
  await expect(page.locator(".cc-clause")).toHaveCount(rental.clauses.length);
  await expect(page.locator(".cc-question")).toHaveCount(rental.questions.length);
  await expect(page.getByText(en.results.disclaimer ?? "")).toBeVisible();
});

test("filter: High and Medium show only their flags and select the first one", async ({ page }) => {
  await page.goto("/results/sample/rental");
  const order = ranked(rental.flags);
  const group = page.getByRole("group", { name: "Show flags" });

  for (const level of ["high", "medium"] as const) {
    await group.getByRole("button", { name: level === "high" ? "High" : "Medium" }).click();
    await expect(
      group.getByRole("button", { name: level === "high" ? "High" : "Medium" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expandAll(page);
    const expected = order.filter((f) => f.severity === level).map((f) => f.id);
    await expect(page.locator(".cc-flag")).toHaveCount(expected.length);
    expect(
      await page
        .locator(".cc-flag")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-flag-id"))),
    ).toEqual(expected);
    const firstId = expected[0] ?? "";
    await expect(page.locator(`[data-flag-id="${firstId}"] .cc-flag__head`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  }

  await group.getByRole("button", { name: "All" }).click();
  await expandAll(page);
  await expect(page.locator(".cc-flag")).toHaveCount(order.length);
  await expect(
    page.locator(`[data-flag-id="${order[0]?.id ?? ""}"] .cc-flag__head`),
  ).toHaveAttribute("aria-expanded", "true");
});

test("filter with no matching flags says so", async ({ page }) => {
  await showResult(
    page,
    withFlags(rental, (f) => f.severity === "medium"),
  );
  await page
    .getByRole("group", { name: "Show flags" })
    .getByRole("button", { name: "High" })
    .click();
  await expect(page.getByText(en.results.noFlagsAtLevel ?? "")).toBeVisible();
  await expect(page.locator(".cc-flag")).toHaveCount(0);
  await expect(viewer(page).locator("mark")).toHaveCount(0);
});

test("an empty result shows the empty-result copy and still shows the clause readings", async ({
  page,
}) => {
  await showResult(
    page,
    withFlags(rental, () => false),
  );
  await expect(page.getByText(en.results.empty ?? "")).toBeVisible();
  await expect(page.getByRole("group", { name: "Show flags" })).toHaveCount(0);
  await expect(page.locator(".cc-clause")).toHaveCount(rental.clauses.length);
  await expect(page.locator(".cc-score")).toHaveAttribute("data-score", "0");
});

test("result warnings show a visible notice", async ({ page }) => {
  await showResult(
    page,
    withFlags(rental, () => true, ["partial_verification", "low_confidence_type"]),
  );
  await expect(page.locator('[data-warning="partial_verification"]')).toHaveText(
    en.results.warningPartial ?? "",
  );
  await expect(page.locator('[data-warning="low_confidence_type"]')).toHaveText(
    (en.results.warningLowType ?? "").replace("{type}", rental.docTypeLabel),
  );
});
