import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "./guard.js";
import { ERROR_CODES } from "../../shared/src/errors.js";
import type { AnalysisResult, Flag } from "../../shared/src/schemas.js";
import { SCENARIO_SERVERS } from "../../playwright.config.js";

// Prompt 17: the SPEC section 12 flows that no earlier spec covers end to end.
// The flows already covered elsewhere are listed in docs/ASSUMPTIONS.md (A159):
// every flag with its highlight (results.spec.ts), the filter (results.spec.ts),
// checklist ticking (checklist.spec.ts), each error code (landing.spec.ts),
// cancel (landing.spec.ts, cancel.spec.ts), paste (landing.spec.ts), the bottom
// sheet (results-mobile.spec.ts) and print (states.spec.ts, checklist.spec.ts).
const ROOT = process.cwd();
const DOCS = path.join(ROOT, "fixtures", "docs");
const DEVANAGARI = /[ऀ-ॿ]/;
const rental = (
  JSON.parse(readFileSync(path.join(ROOT, "fixtures/samples/rental.json"), "utf8")) as {
    en: AnalysisResult;
  }
).en;
const en = JSON.parse(readFileSync(path.join(ROOT, "client/src/i18n/en.json"), "utf8")) as {
  errors: Record<string, string>;
  landing: Record<string, string>;
};

const LEASE = [
  "LEAVE AND LICENSE AGREEMENT FOR A FLAT IN PUNE",
  "",
  "1. The licensee shall pay a monthly licence fee of Rs. 25,000 on the fifth day of each month.",
  "",
  "2. The licensor may enter the premises at any time without notice to inspect them.",
  "",
  "3. If the licensee leaves before the lock-in ends, the licensee shall forfeit the whole deposit.",
].join("\n");

function ranked(flags: readonly Flag[]): Flag[] {
  const rank = (f: Flag) => (f.kind === "missing" ? 2 : f.severity === "high" ? 0 : 1);
  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.i - b.i)
    .map(({ flag }) => flag);
}
const present = ranked(rental.flags).filter((f) => f.kind === "present");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The English message for a code, with every {placeholder} matching any number. */
const messagePattern = (code: string) =>
  new RegExp(
    escape(en.errors[code] ?? "")
      .replace(/\\\{(?:mb|pages)\\\}/g, "\\d+")
      .replace(/\\\{n\\\}/g, "\\d+"),
  );

const head = (page: Page, flag: Flag) => page.locator(`[data-flag-id="${flag.id}"] .cc-flag__head`);
const sheet = (page: Page) => page.locator("dialog.cc-sheet-dialog[open]");
const phoneLayout = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

/**
 * The AnalysisResult the server streamed, read from the SSE body. The stream is
 * `no-store` (A176), so Chromium drops its body once the app moves to /results and
 * `response.text()` fails; the page keeps a copy instead, through `clone()`, which
 * leaves the stream the app reads untouched.
 */
async function streamedResult(page: Page, run: () => Promise<void>): Promise<AnalysisResult> {
  await page.evaluate(() => {
    const w = window as unknown as { __ccAnalyzeBody?: Promise<string>; __ccTee?: boolean };
    if (w.__ccTee === true) return;
    w.__ccTee = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/analyze")) w.__ccAnalyzeBody = response.clone().text();
      return response;
    };
  });
  await run();
  const body = await page
    .waitForFunction(
      () => (window as unknown as { __ccAnalyzeBody?: Promise<string> }).__ccAnalyzeBody,
    )
    .then(() =>
      page.evaluate(
        () => (window as unknown as { __ccAnalyzeBody: Promise<string> }).__ccAnalyzeBody,
      ),
    );
  const event = body.split("\n\n").find((block) => block.startsWith("event: result"));
  if (event === undefined) throw new Error("no result event");
  return JSON.parse(event.slice(event.indexOf("data: ") + 6)) as AnalysisResult;
}

async function choosePdf(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a PDF" }).click();
  await (await chooser).setFiles(path.join(DOCS, file));
}

async function pasteText(page: Page, text: string) {
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Paste the text of your document").fill(text);
  await page.getByRole("button", { name: "Check this text" }).click();
}

/** The header toggle, or the sheet's own one while the modal sheet is open (A128). */
async function toggleLanguage(page: Page, lang: "en" | "hi") {
  const scope = (await sheet(page).count()) > 0 ? sheet(page) : page.locator("header.cc-header");
  await scope.getByRole("button", { name: lang === "hi" ? /^HI/ : /^EN/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

async function closeSheet(page: Page) {
  if ((await sheet(page).count()) === 0) return;
  await page.mouse.move(0, 0);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
}

/** The viewer that holds the marks: the sticky panel, or the sheet below 1024 px. */
const viewer = (page: Page) =>
  phoneLayout(page)
    ? sheet(page).getByTestId("document-viewer")
    : page.getByTestId("document-viewer");

function onlyOn(testInfo: TestInfo, project: string, why: string) {
  test.skip(testInfo.project.name !== project, why);
}

// Smooth scrolling moves buttons mid-click (results.spec.ts covers motion).
test.use({ reducedMotion: "reduce" });

test("landing to sample to results: a flag selected shows its quote in the document", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/analyze")) calls.push(r.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Rental agreement" }).click();
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  await expect(page.locator(".cc-flag")).toHaveCount(
    Math.min(rental.flags.length, (page.viewportSize()?.width ?? 0) < 640 ? 3 : Infinity),
  );

  const first = present[0];
  if (first === undefined) throw new Error("the rental sample has a flag with a quote");
  await head(page, first).click();
  await expect(head(page, first)).toHaveAttribute("aria-expanded", "true");
  const mark = viewer(page).locator(`mark[data-flag-id="${first.id}"]`);
  await expect(mark).toHaveCount(1);
  expect((await mark.innerText()).replace(/\s+/g, " ").trim()).toBe(
    (first.quote ?? "").replace(/\s+/g, " ").trim(),
  );
  // Samples cost no API call (SPEC F14).
  expect(calls).toEqual([]);
});

test("Hindi and back keeps the selected flag, the open sheet and the ticks", async ({ page }) => {
  const flag = present[1];
  const item = rental.checklist.before[0];
  if (flag === undefined || item === undefined) throw new Error("fixture too small");
  const box = page.locator(`[data-item-id="${item.id}"] input[type="checkbox"]`);

  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  // Tick one item first, then come back (SPEC section 9: results to checklist keeps everything).
  await page.locator(".cc-results__next a").click();
  await expect(page).toHaveURL(/\/checklist$/);
  await box.check();
  await page.locator(".cc-checklist__back").click();
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);

  await head(page, flag).click();
  await expect(head(page, flag)).toHaveAttribute("aria-expanded", "true");
  if (phoneLayout(page)) await expect(sheet(page)).toHaveCount(1);

  await toggleLanguage(page, "hi");
  await expect(head(page, flag)).toHaveAttribute("aria-expanded", "true");
  await expect(viewer(page).locator(`mark[data-flag-id="${flag.id}"]`)).toHaveCount(1);
  if (phoneLayout(page)) await expect(sheet(page)).toHaveCount(1);
  await expect(page.locator(`[data-flag-id="${flag.id}"] .cc-flag__label`)).toHaveText(DEVANAGARI);

  await toggleLanguage(page, "en");
  await expect(head(page, flag)).toHaveAttribute("aria-expanded", "true");
  await expect(viewer(page).locator(`mark[data-flag-id="${flag.id}"]`)).toHaveCount(1);
  if (phoneLayout(page)) await expect(sheet(page)).toHaveCount(1);

  // The tick survived both toggles and the trip back and forth.
  await closeSheet(page);
  await toggleLanguage(page, "hi");
  await page.locator(".cc-results__next a").click();
  await expect(page).toHaveURL(/\/checklist$/);
  await expect(box).toBeChecked();
  await toggleLanguage(page, "en");
  await expect(box).toBeChecked();
  await expect(page.locator(".cc-progress__count")).toHaveText(
    `1 of ${String(rental.checklist.before.length + rental.checklist.after.length)} done`,
  );
  // And the selection is still there on the way back.
  await page.locator(".cc-checklist__back").click();
  await expect(head(page, flag)).toHaveAttribute("aria-expanded", "true");
});

test.describe("upload happy path for each detailed type", () => {
  const cases: [string, RegExp][] = [
    ["rental.pdf", /rental|leave and licen[cs]e/i],
    ["employment.pdf", /employment|job/i],
    ["loan.pdf", /loan|credit/i],
    ["terms.pdf", /terms/i],
  ];
  for (const [file, type] of cases) {
    test(file, async ({ page }) => {
      await page.goto("/");
      const result = await streamedResult(page, async () => {
        await choosePdf(page, file);
        await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
      });
      await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
      await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
      await expect(page.locator(".cc-verdict__detected")).toHaveText(type);
      // Every flag shown is one the server verified: its quote is in its segment.
      const text = new Map(result.segments.map((s) => [s.id, s.text]));
      const shown = await page
        .locator(".cc-flag")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-flag-id")));
      expect(shown.length).toBeGreaterThan(0);
      for (const id of shown) {
        const flag = result.flags.find((f) => f.id === id);
        expect(flag, String(id)).toBeDefined();
        if (flag?.kind === "present") {
          expect(text.get(flag.segmentId ?? "")).toContain(flag.quote);
        }
      }
    });
  }
});

test("every shared error code has a UI test", ({}, testInfo) => {
  onlyOn(testInfo, "desktop", "a static check of the spec files, run once");
  const titles = readdirSync(path.join(ROOT, "client/e2e"))
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => readFileSync(path.join(ROOT, "client/e2e", f), "utf8"))
    .join("\n");
  // A code counts as covered when a test asserts its strip by data-error-code
  // or names it in a title, as landing.spec.ts does for each one.
  const uncovered = ERROR_CODES.filter(
    (code) => !new RegExp(`["'\`\\[]${code}["'\`\\] (]`).test(titles),
  );
  expect(uncovered).toEqual([]);
});

test("keyboard only: sample, a flag, the checklist and a tick", async ({ page }) => {
  await page.goto("/");
  const tabTo = async (match: (el: { text: string; cls: string; tag: string }) => boolean) => {
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press("Tab");
      const el = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return {
          text: (a?.textContent ?? "").trim(),
          cls: typeof a?.className === "string" ? a.className : "",
          tag: a?.tagName.toLowerCase() ?? "",
        };
      });
      if (match(el)) return;
    }
    throw new Error("Tab never reached the control");
  };

  await tabTo((el) => el.tag === "a" && el.text === "Rental agreement");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();

  await tabTo((el) => el.cls.includes("cc-flag__head"));
  const focused = page.locator(".cc-flag__head:focus");
  const id = await focused.evaluate((el) =>
    el.closest("[data-flag-id]")?.getAttribute("data-flag-id"),
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(`[data-flag-id="${id ?? ""}"] .cc-flag__head`)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const flag = rental.flags.find((f) => f.id === id);
  if (flag?.kind === "present") {
    if (phoneLayout(page)) await expect(sheet(page)).toHaveCount(1);
    await expect(viewer(page).locator(`mark[data-flag-id="${id ?? ""}"]`)).toHaveCount(1);
    if (phoneLayout(page)) {
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.locator(`[data-flag-id="${id ?? ""}"] .cc-flag__head`)).toBeFocused();
    }
  }

  await tabTo((el) => el.tag === "a" && el.text.startsWith("Next: your before-and-after"));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/checklist$/);
  await tabTo((el) => el.tag === "input");
  await page.keyboard.press("Space");
  await expect(page.locator('input[type="checkbox"]:focus')).toBeChecked();
  await expect(page.locator(".cc-progress__count")).toHaveText(/^1 of \d+ done$/);
});

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
  // A11: Devanagari input is refused on the server. The guard's language check
  // then runs on an English page and must find nothing (A159).
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
  // The server never lets this through (A11); a stubbed result puts it in the
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

test.describe("provider behaviour on the scenario servers (A158)", () => {
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
