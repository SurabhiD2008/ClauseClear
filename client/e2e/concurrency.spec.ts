import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import type { AnalysisResult } from "../../shared/src/schemas.js";
import { SCENARIO_SERVERS } from "../../playwright.config.js";

// Prompt 17: concurrency through the browser and the API (SPEC section 13 rule 5,
// Builds_skills.md section 9). The unit tests in client/src/state/analysis.test.ts
// cover the same guards on the store; these prove them on the real page and server.
const ROOT = process.cwd();
const rental = (
  JSON.parse(readFileSync(path.join(ROOT, "fixtures/samples/rental.json"), "utf8")) as {
    en: AnalysisResult;
  }
).en;

const LEASE = [
  "LEAVE AND LICENSE AGREEMENT FOR A FLAT IN PUNE",
  "",
  "1. The licensee shall pay a monthly licence fee of Rs. 25,000 on the fifth day of each month.",
  "",
  "2. The licensor may enter the premises at any time without notice to inspect them.",
  "",
  "3. If the licensee leaves before the lock-in ends, the licensee shall forfeit the whole deposit.",
].join("\n");

const LATE_TITLE = "LATE ANSWER FROM THE FIRST RUN";
const lateBody = `event: status\ndata: {"step":"reading"}\n\nevent: result\ndata: ${JSON.stringify({ ...rental, title: LATE_TITLE })}\n\n`;

function analyzeRequests(page: Page) {
  const calls: string[] = [];
  const failed: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/analyze")) calls.push(r.postData() ?? "");
  });
  page.on("requestfailed", (r) => {
    if (r.url().includes("/api/analyze")) failed.push(r.failure()?.errorText ?? "");
  });
  return { calls, failed };
}

async function openPaste(page: Page) {
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Paste the text of your document").fill(LEASE);
  return page.getByRole("button", { name: "Check this text" });
}

/** Holds the first /api/analyze request until release(); later ones reach the server. */
async function holdFirstRun(page: Page) {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/api/analyze", async (route) => {
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    await held;
    // The browser has aborted this request by now, so this answer has nowhere
    // to go; if it ever arrived, the stale-run guard must drop it.
    await route
      .fulfill({ status: 200, contentType: "text/event-stream", body: lateBody })
      .catch(() => undefined);
  });
  return () => {
    release();
  };
}

test.use({ reducedMotion: "reduce" });

test("a double-click on Check this text sends exactly one request", async ({ page }) => {
  const { calls } = analyzeRequests(page);
  await page.goto("/");
  const check = await openPaste(page);
  await check.dblclick();
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await page.waitForTimeout(500);
  expect(calls).toHaveLength(1);
});

test("two clicks in the same task (faster than a render) still send one request", async ({
  page,
}) => {
  const { calls } = analyzeRequests(page);
  await page.goto("/");
  const check = await openPaste(page);
  await check.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await page.waitForTimeout(500);
  expect(calls).toHaveLength(1);
});

test("opening a sample mid-run aborts the run, and its late answer is ignored", async ({
  page,
}) => {
  const { calls, failed } = analyzeRequests(page);
  const release = await holdFirstRun(page);
  await page.goto("/");
  await (await openPaste(page)).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

  await page.getByRole("link", { name: "Rental agreement" }).click();
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await expect.poll(() => failed).toEqual(["net::ERR_ABORTED"]);

  release();
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await expect(page.getByText(LATE_TITLE)).toHaveCount(0);
  expect(calls).toHaveLength(1);
});

test("a second run after Cancel wins; the first run's late answer is ignored", async ({ page }) => {
  const { calls, failed } = analyzeRequests(page);
  const release = await holdFirstRun(page);
  await page.goto("/");
  await (await openPaste(page)).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator('[data-error-code="CANCELLED"]')).toBeVisible();
  await expect.poll(() => failed).toEqual(["net::ERR_ABORTED"]);

  // The second run goes to the real (mock) server.
  await (await openPaste(page)).click();
  release();
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  await expect(page.locator(".cc-results__name")).toHaveText(/^LEAVE AND LICENSE AGREEMENT/);
  await page.waitForTimeout(1_000);
  await expect(page.getByText(LATE_TITLE)).toHaveCount(0);
  expect(calls).toHaveLength(2);
});

test("10 parallel API analyses respect the IP limit and the call queue", async ({
  request,
}, testInfo) => {
  // One client IP for every project, so the limit can be spent only once.
  test.skip(testInfo.project.name !== "desktop", "an API test, run once");
  test.setTimeout(60_000);
  const url = `http://127.0.0.1:${String(SCENARIO_SERVERS.limits)}/api/analyze?stream=0`;
  const started = Date.now();
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => request.post(url, { data: { text: LEASE } })),
  );
  const elapsed = Date.now() - started;
  const statuses = responses.map((r) => r.status());
  const bodies = (await Promise.all(responses.map((r) => r.json()))) as Record<string, unknown>[];

  // IP_ANALYSES_PER_10_MIN=6 on that server: exactly 6 run, 4 are refused.
  expect(statuses.filter((s) => s === 200)).toHaveLength(6);
  expect(statuses.filter((s) => s === 429)).toHaveLength(4);
  for (const [i, body] of bodies.entries()) {
    if (statuses[i] === 429) {
      expect(body.code).toBe("RATE_LIMITED");
      expect(body.retryAfterSec).toBeGreaterThan(0);
    } else {
      expect(body.version).toBe(1);
      expect(body.title).toMatch(/^LEAVE AND LICENSE AGREEMENT/);
    }
  }
  // LLM_CONCURRENCY=2 with 1 s per mock call: 6 analyses need at least 3 rounds.
  // Without the queue they would all finish in about 1 s.
  expect(elapsed).toBeGreaterThanOrEqual(2_900);
});

test("a doubled Space on Check this text starts one run and does not cancel it (A178)", async ({
  page,
}) => {
  const { calls } = analyzeRequests(page);
  await page.goto("/");
  const check = await openPaste(page);
  await check.focus();
  // The first Space starts the run and moves focus to Cancel; the second lands there.
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/\/results$/, { timeout: 15_000 });
  expect(calls).toHaveLength(1);
});

test("a double-click on a sample link opens it once: one fetch, one history entry (A178)", async ({
  page,
}) => {
  const samples: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/samples/")) samples.push(r.url());
  });
  await page.goto("/");
  const before = await page.evaluate(() => history.length);
  await page.getByRole("link", { name: "Rental agreement" }).first().dblclick();
  await expect(page).toHaveURL(/\/results\/sample\/rental$/);
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
  expect(samples).toHaveLength(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});
