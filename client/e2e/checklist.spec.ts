import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import type { AnalysisResult, ChecklistItem, Flag } from "../../shared/src/schemas.js";

// Prompt 14: the checklist page (SPEC F17, design.md 5.4) on the rental sample.
// Every expected count is computed here from the fixture, not written by hand.
const ROOT = process.cwd();
const rental = (
  JSON.parse(readFileSync(path.join(ROOT, "fixtures/samples/rental.json"), "utf8")) as {
    en: AnalysisResult;
  }
).en;
const { before, after } = rental.checklist;
const items = [...before, ...after];

function ranked(flags: readonly Flag[]): Flag[] {
  const rank = (f: Flag) => (f.kind === "missing" ? 2 : f.severity === "high" ? 0 : 1);
  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.i - b.i)
    .map(({ flag }) => flag);
}
const numberOf = new Map(ranked(rental.flags).map((flag, i) => [flag.id, i + 1]));

function expected(ticked: ReadonlySet<string>) {
  const b = before.filter((item) => ticked.has(item.id)).length;
  const a = after.filter((item) => ticked.has(item.id)).length;
  return {
    done: `${String(a + b)} of ${String(items.length)} done`,
    split: `Before signing ${String(b)}/${String(before.length)} · After signing ${String(a)}/${String(after.length)}`,
    now: a + b,
    percent: ((a + b) / items.length) * 100,
  };
}

test.use({ reducedMotion: "reduce" });

const box = (page: Page, item: ChecklistItem) =>
  page.locator(`[data-item-id="${item.id}"] input[type="checkbox"]`);

async function openChecklist(page: Page) {
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await page.getByRole("link", { name: /before-and-after checklist/ }).click();
  await expect(page).toHaveURL(/\/checklist$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Before you sign, and after" }),
  ).toBeVisible();
}

async function expectProgress(page: Page, ticked: ReadonlySet<string>) {
  const want = expected(ticked);
  const bar = page.getByRole("progressbar", { name: "Checklist progress" });
  await expect(page.locator(".cc-progress__count")).toHaveText(want.done);
  await expect(page.locator(".cc-progress__split")).toHaveText(want.split);
  await expect(bar).toHaveAttribute("aria-valuenow", String(want.now));
  await expect(bar).toHaveAttribute("aria-valuemin", "0");
  await expect(bar).toHaveAttribute("aria-valuemax", String(items.length));
  await expect(bar).toHaveAttribute("aria-valuetext", want.done);
  const fill = await page.locator(".cc-progress__fill").evaluate((el) => {
    const parent = el.parentElement;
    if (parent === null) return -1;
    return (el.getBoundingClientRect().width / parent.clientWidth) * 100;
  });
  expect(Math.abs(fill - want.percent)).toBeLessThan(0.5);
}

test("tick and untick update the count, the split and the bar", async ({ page }) => {
  await openChecklist(page);
  await expect(page.getByRole("checkbox")).toHaveCount(items.length);
  const ticked = new Set<string>();
  await expectProgress(page, ticked);

  // Tick every item in page order, then untick them in reverse.
  for (const item of items) {
    await page.locator(`label[for="check-${item.id}"]`).click();
    ticked.add(item.id);
    await expect(box(page, item)).toBeChecked();
    await expect(page.locator(`[data-item-id="${item.id}"]`)).toHaveAttribute(
      "data-ticked",
      "true",
    );
    await expectProgress(page, ticked);
  }
  const strike = await page
    .locator(`[data-item-id="${items[0]?.id ?? ""}"] .cc-check__text`)
    .evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(strike).toContain("line-through");
  for (const item of [...items].reverse()) {
    await box(page, item).click();
    ticked.delete(item.id);
    await expect(box(page, item)).not.toBeChecked();
    await expectProgress(page, ticked);
  }
});

test("Space ticks a focused checkbox (keyboard only)", async ({ page }) => {
  await openChecklist(page);
  const first = items[0];
  if (first === undefined) throw new Error("no items");
  await box(page, first).focus();
  await page.keyboard.press("Space");
  await expect(box(page, first)).toBeChecked();
  await expectProgress(page, new Set([first.id]));
  await page.keyboard.press("Space");
  await expect(box(page, first)).not.toBeChecked();
});

test("ticks persist in sessionStorage by analysis id and reset on a new analysis", async ({
  page,
}) => {
  await openChecklist(page);
  const [first, second] = items;
  if (first === undefined || second === undefined) throw new Error("need two items");
  await box(page, first).check();
  await box(page, second).check();
  const stored = await page.evaluate(() => sessionStorage.getItem("cc.ticks.sample:rental"));
  // Only item ids are stored, never document text.
  expect(JSON.parse(stored ?? "null")).toEqual([first.id, second.id]);

  // Toggling the language keeps the ticks.
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(box(page, first)).toBeChecked();
  await page.getByRole("banner").getByRole("button", { name: /^EN/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // A page load of the sample restores them.
  await page.getByRole("link", { name: "← Back to your result" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await page.getByRole("link", { name: /before-and-after checklist/ }).click();
  await expect(box(page, first)).toBeChecked();
  await expect(box(page, second)).toBeChecked();
  await expectProgress(page, new Set([first.id, second.id]));

  // Choosing the sample again from the landing page is a new analysis: nothing ticked.
  await page.goto("/");
  await page
    .getByRole("link", { name: /^Rental/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await page.getByRole("link", { name: /before-and-after checklist/ }).click();
  await expect(box(page, first)).not.toBeChecked();
  await expectProgress(page, new Set());
  expect(await page.evaluate(() => sessionStorage.getItem("cc.ticks.sample:rental"))).toBeNull();
});

test("every tag links back to its flag on the results page, open and focused", async ({ page }) => {
  await openChecklist(page);
  const tagged = items.flatMap((item) => item.flagIds.map((flagId) => ({ item, flagId })));
  expect(tagged.length).toBeGreaterThan(0);
  for (const { item, flagId } of tagged) {
    const flag = rental.flags.find((f) => f.id === flagId);
    if (flag === undefined) throw new Error(`unknown flag ${flagId}`);
    const n = numberOf.get(flagId) ?? 0;
    const name =
      flag.kind === "missing" ? "Missing clause" : `Flag ${String(n)} · ${flag.category}`;
    const link = page.locator(`[data-item-id="${item.id}"]`).getByRole("link", { name });
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(/\/results\/sample\/rental$/);
    const head = page.locator(`[data-flag-id="${flagId}"] .cc-flag__head`);
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(head).toBeFocused();
    await expect(head).toBeInViewport();
    // The sheet stays shut: the tag opens the flag, not the document.
    await expect(page.locator("dialog.cc-sheet-dialog[open]")).toHaveCount(0);
    await page.getByRole("link", { name: /before-and-after checklist/ }).click();
    await expect(page).toHaveURL(/\/checklist$/);
  }
});

test("Copy as text puts both lists on the clipboard and announces it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openChecklist(page);
  const first = items[0];
  if (first === undefined) throw new Error("no items");
  await box(page, first).check();
  await page.getByRole("button", { name: "Copy as text" }).click();
  await expect(page.getByTestId("copy-status")).toHaveText("Copied");
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

  const tag = (item: ChecklistItem) => {
    if (item.flagIds.length === 0) return "";
    const ns = item.flagIds.map((id) => numberOf.get(id) ?? 0).sort((x, y) => x - y);
    const [only] = item.flagIds;
    const flag = rental.flags.find((f) => f.id === only);
    if (ns.length === 1 && flag !== undefined) {
      return flag.kind === "missing"
        ? " (Missing clause)"
        : ` (Flag ${String(ns[0])} · ${flag.category})`;
    }
    const list = ns.map(String);
    return ` (Flags ${list.slice(0, -1).join(", ")} and ${list.at(-1) ?? ""})`;
  };
  const line = (item: ChecklistItem) =>
    `${item.id === first.id ? "[x]" : "[ ]"} ${item.text}${tag(item)}`;
  const want = [
    "Before you sign, and after",
    `1 of ${String(items.length)} done`,
    "",
    "Before you sign",
    ...before.map(line),
    "",
    "After you sign",
    ...after.map(line),
  ].join("\n");
  const got = await page.evaluate(() => navigator.clipboard.readText());
  // The Windows clipboard stores line breaks as CRLF.
  expect(got.replace(/\r\n/g, "\n")).toBe(want);
});

test("Print opens the print dialog; the print view drops the buttons and the header", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await openChecklist(page);
  await page.getByRole("button", { name: "Print" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("checkbox")).toHaveCount(items.length);
  await expect(page.getByRole("progressbar")).toBeVisible();
});

test("refresh on /checklist goes home with the not-stored note", async ({ page }) => {
  await openChecklist(page);
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/isn.t stored/i).first()).toBeVisible();
});

test("no horizontal scroll on the checklist", async ({ page }) => {
  await openChecklist(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
});
