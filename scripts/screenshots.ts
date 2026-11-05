// npm run screenshots (prompt 21): five fixed screenshots from the bundled
// sample data, for the README. No AI calls, no keys.
//   docs/screenshots/landing.png          landing page, desktop
//   docs/screenshots/results-desktop.png  rental sample results, desktop
//   docs/screenshots/results-mobile.png   rental sample results, phone
//   docs/screenshots/checklist.png        the sample checklist, desktop
//   docs/screenshots/results-hindi.png    rental sample results in Hindi, desktop
// Needs `npm run build` first. It starts the built server itself with the mock
// provider on a spare port and stops it at the end; set SCREENSHOT_URL to use a
// server that is already running instead.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/screenshots");
// Not 4190: fetch refuses it (a blocked port in the Fetch standard).
const PORT = 4187;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function waitForHealth(base: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`no server at ${base} after ${String(timeoutMs)} ms`);
}

let server: ChildProcess | undefined;
let base = process.env.SCREENSHOT_URL?.replace(/\/+$/, "");
if (base === undefined) {
  try {
    await stat(join(root, "server/dist/start.js"));
    await stat(join(root, "client/dist/index.html"));
  } catch {
    console.error("Build first: npm run build");
    process.exit(1);
  }
  base = `http://127.0.0.1:${String(PORT)}`;
  server = spawn(process.execPath, ["server/dist/start.js"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", LLM_PROVIDER_ORDER: "mock", PORT: String(PORT) },
    stdio: process.env.SCREENSHOT_DEBUG === "1" ? "inherit" : "ignore",
  });
}

/** Fonts loaded and nothing still moving, so every shot is the settled page. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

try {
  await waitForHealth(base, 30_000);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const shots: [string, () => Promise<Page>][] = [];

  const open = async (path: string, viewport: { width: number; height: number }, phone = false) => {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: phone ? 2 : 1,
      isMobile: phone,
      hasTouch: phone,
      // First visit, so English (the language rule); no stored choice.
      locale: "en-IN",
    });
    const page = await context.newPage();
    await page.goto(base + path);
    return page;
  };

  shots.push([
    "landing.png",
    async () => {
      const page = await open("/", DESKTOP);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      return page;
    },
  ]);
  shots.push([
    "results-desktop.png",
    async () => {
      const page = await open("/results/sample/rental", DESKTOP);
      await page.locator(".cc-verdict").first().waitFor();
      return page;
    },
  ]);
  shots.push([
    "results-mobile.png",
    async () => {
      const page = await open("/results/sample/rental", PHONE, true);
      await page.locator(".cc-verdict").first().waitFor();
      return page;
    },
  ]);
  shots.push([
    "checklist.png",
    async () => {
      // /checklist opened cold has no result and goes home, so open it the way a
      // visitor does: the landing page's sample checklist link loads the sample.
      const page = await open("/", DESKTOP);
      await page.getByRole("link", { name: /Open the sample checklist/ }).click();
      await page.waitForURL(/\/checklist$/);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      return page;
    },
  ]);
  shots.push([
    "results-hindi.png",
    async () => {
      const page = await open("/results/sample/rental", DESKTOP);
      await page.locator(".cc-verdict").first().waitFor();
      await page.getByRole("button", { name: "HI (Hindi)" }).click();
      await page.waitForFunction(() => document.documentElement.lang === "hi");
      return page;
    },
  ]);

  for (const [file, make] of shots) {
    const page = await make();
    await settle(page);
    const path = join(outDir, file);
    await page.screenshot({ path });
    const { size } = await stat(path);
    const vp = page.viewportSize();
    console.log(
      `  docs/screenshots/${file.padEnd(20)} ${String(vp?.width)}x${String(vp?.height)}  ${String(Math.round(size / 1024))} KB`,
    );
    await page.context().close();
  }
  await browser.close();
  console.log(`\n${String(shots.length)} screenshots from sample data (no AI calls)`);
} finally {
  server?.kill();
}
