import { expect, GUARD_CHECKS, test, type GuardCheck, type Violation } from "./guard.js";

// Proves each oddity-guard check can fail (prompt 16). Every check has a page in
// client/e2e/guard-pages/ that breaks that rule on purpose, served at /__guard/
// only when E2E_GUARD_PAGES=1. Each test collects the findings, asserts the
// check caught its page, prints what it caught, then returns to the clean
// control page so the guard's own end-of-test run passes.

/** What each broken page must produce, as patterns over the finding's detail. */
const EXPECTED: Record<GuardCheck, RegExp[]> = {
  console: [/^console\.error: guard self-test/, /^console\.warn: guard self-test/],
  runtime: [/uncaught error/, /unhandled rejection/],
  network: [
    /^HTTP 404 not expected/,
    /^request to another host: http:\/\/localhost/,
    /^request failed/,
  ],
  overflow: [/^page scrollWidth/, /is 2000 px wide/],
  clipping: [/^<p\.clip>/],
  targets: [/^<button\.tiny> "x" is 20\.0x20\.0 px$/],
  semantics: [
    /^<img> has no alt$/,
    /^id "dup" is used 2 times$/,
    /^<button\.cc-tap> has no accessible name$/,
    /^<a\.cc-tap> has no accessible name$/,
  ],
  axe: [/^color-contrast \(serious\)/, /^label \(critical\)/],
  "layout-shift": [/^CLS \d\.\d{3} on \/__guard\/layout-shift\.html/],
  language: [
    /^Devanagari in English mode/,
    /^untranslated key on screen: results\.changeType$/,
    /^mixed script in one word/,
    /^unfilled placeholder/,
  ],
  focus: [
    /^no visible focus ring on <button> "No ring"$/,
    /^Tab lands on a hidden element: <button> "Invisible"$/,
    /^keyboard trap: Tab stays on <input> "Trap"$/,
  ],
  motion: [/^spin running on/, /^scroll-behavior: smooth on <html>$/],
};

const report = (check: GuardCheck, found: Violation[]) => {
  for (const v of found.filter((f) => f.check === check))
    console.log(`  caught [${check}] ${v.detail}`);
};

test("the control page passes every check", async ({ page, guard }) => {
  await page.goto("/__guard/clean.html");
  await page.waitForTimeout(500);
  expect(await guard.collect()).toEqual([]);
  console.log("  control page: 0 findings");
});

for (const check of GUARD_CHECKS) {
  test(`the ${check} check fails its broken page`, async ({ page, guard }, testInfo) => {
    const phone = testInfo.project.use.isMobile === true;
    if (check === "motion") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/__guard/${check}.html`);
    // Let the timers on the runtime, network and layout-shift pages fire. The
    // shift waits 1.5 s so it falls outside Chrome's 500 ms input window.
    await page.waitForTimeout(check === "layout-shift" ? 2200 : 500);
    const found = await guard.collect();
    const mine = found.filter((f) => f.check === check).map((f) => f.detail);

    if (check === "targets" && !phone) {
      // Tap targets are a phone rule: the same page passes on a desktop project.
      expect(mine).toEqual([]);
      console.log(
        `  [targets] not a phone project (${testInfo.project.name}): 0 findings, as intended`,
      );
    } else {
      for (const pattern of EXPECTED[check]) {
        expect(mine, `[${check}] should catch ${String(pattern)}`).toContainEqual(
          expect.stringMatching(pattern),
        );
      }
      report(check, found);
    }

    await page.goto("/__guard/clean.html");
    guard.reset();
  });
}

test("a finding fails the test it happens in", async ({ page }) => {
  // Expected to fail: the guard's end-of-test run finds the console error.
  test.fail();
  await page.goto("/__guard/console.html");
  await page.waitForTimeout(300);
});

// The language exemption (AUDIT.md, "Guard exemptions"), from both sides.
test.describe("layout shift after a language change", () => {
  const shifts = (found: Violation[]) =>
    found.filter((f) => f.check === "layout-shift").map((f) => f.detail);

  test("is not counted when a click asked for it", async ({ page, guard }) => {
    await page.goto("/__guard/layout-shift-lang.html?mode=click");
    await page.getByRole("button", { name: "Switch language" }).click();
    await page.waitForTimeout(2200);
    expect(shifts(await guard.collect())).toEqual([]);
    console.log("  [layout-shift] swap the user asked for: 0 findings, as intended");
  });

  test("is counted without a click first", async ({ page, guard }) => {
    await page.goto("/__guard/layout-shift-lang.html?mode=auto");
    await page.waitForTimeout(2200);
    const found = shifts(await guard.collect());
    expect(found).toContainEqual(expect.stringMatching(/^CLS \d\.\d{3} on \/__guard\//));
    console.log(`  caught [layout-shift] ${found[0] ?? ""}`);
    await page.goto("/__guard/clean.html");
    guard.reset();
  });

  test("is counted when the move comes more than 500 ms after the change", async ({
    page,
    guard,
  }) => {
    await page.goto("/__guard/layout-shift-lang.html?mode=late");
    await page.getByRole("button", { name: "Switch language" }).click();
    await page.waitForTimeout(3000);
    const found = shifts(await guard.collect());
    expect(found).toContainEqual(expect.stringMatching(/^CLS \d\.\d{3} on \/__guard\//));
    console.log(`  caught [layout-shift] ${found[0] ?? ""}`);
    await page.goto("/__guard/clean.html");
    guard.reset();
  });
});
