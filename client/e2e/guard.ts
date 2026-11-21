import { mkdirSync } from "node:fs";
import path from "node:path";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

// The oddity guard: an auto fixture on every end-to-end test.
// While the test runs it records console messages, page errors and network
// traffic; when the test ends it checks the final page for overflow, clipping,
// small tap targets, semantics, axe, layout shift, language, focus and motion.
// Any finding fails the test, with a screenshot in audit/screens/guard/.
//
// Specs import { test, expect } from "./guard" instead of "@playwright/test".
// A test that causes an HTTP error on purpose says so with guard.expectStatus.
// Every exemption below carries its reason in a comment, and the README lists
// them under "Browser guard exemptions".
import { axeFindings } from "./guard/axe.js";
import { focusWalk } from "./guard/focus.js";
import { clsScript } from "./guard/layoutShift.js";
import { pageChecks } from "./guard/pageChecks.js";
import {
  CLS_LIMIT,
  I18N_KEYS,
  MIN_TARGET,
  USER_TEXT,
  type Guard,
  type GuardCheck,
  type Violation,
} from "./guard/types.js";

export {
  CLS_LIMIT,
  GUARD_CHECKS,
  MIN_TARGET,
  type Guard,
  type GuardCheck,
  type Violation,
} from "./guard/types.js";

const ROOT = process.cwd();

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

interface Recorded {
  violations: Violation[];
  cls: Map<string, number>;
  /** The biggest shifts of each URL's worst window, with the elements that moved. */
  clsSources: Map<string, string>;
  expected: { url: RegExp; status: number | undefined }[];
}

function isExpected(recorded: Recorded, url: string, status: number) {
  return recorded.expected.some(
    (e) => e.url.test(url) && (e.status === undefined || e.status === status),
  );
}

async function runChecks(
  page: Page,
  testInfo: TestInfo,
  recorded: Recorded,
  origin: string,
): Promise<Violation[]> {
  const found = [...recorded.violations];
  for (const [url, value] of recorded.cls) {
    if (value > CLS_LIMIT) {
      found.push({
        check: "layout-shift",
        detail: `CLS ${value.toFixed(3)} on ${url} (limit ${String(CLS_LIMIT)}); shifts: ${recorded.clsSources.get(url) ?? "?"}`,
      });
    }
  }
  if (page.isClosed()) return found;
  let url: URL;
  try {
    url = new URL(page.url());
  } catch {
    return found;
  }
  if (url.origin !== origin) return found;
  // The checks are about the screen: a test that ended in print emulation is put back.
  await page.emulateMedia({ media: null });
  const phone = testInfo.project.use.isMobile === true;
  const dom = await page.evaluate(pageChecks, {
    phone,
    keys: I18N_KEYS,
    userText: USER_TEXT,
    minTarget: MIN_TARGET,
  });
  found.push(...(dom as Violation[]));
  found.push(...(await axeFindings(page, testInfo.project.name)));
  found.push(...(await focusWalk(page)));
  return found;
}

function format(violations: Violation[], shot: string | null) {
  const lines = violations.map((v) => `  [${v.check}] ${v.detail}`);
  return [
    `Oddity guard: ${String(violations.length)} problem(s)`,
    ...lines,
    ...(shot === null ? [] : [`  screenshot: ${shot}`]),
  ].join("\n");
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page, baseURL }, use, testInfo) => {
      // The test's own baseURL: a spec on a scenario server sets its own.
      const origin = new URL(String(baseURL ?? testInfo.project.use.baseURL)).origin;
      const recorded: Recorded = {
        violations: [],
        cls: new Map(),
        clsSources: new Map(),
        expected: [],
      };
      const add = (check: GuardCheck, detail: string) =>
        recorded.violations.push({ check, detail });

      page.on("console", (message) => {
        const type = message.type();
        if (type !== "error" && type !== "warning") return;
        const text = message.text();
        // Chrome's own line for an HTTP error response; the response itself is
        // judged by the network check, so an expected one is not counted twice.
        if (text.startsWith("Failed to load resource")) {
          const status = Number(/status of (\d+)/.exec(text)?.[1] ?? 0);
          if (isExpected(recorded, message.location().url, status)) return;
        }
        add("console", `console.${type === "warning" ? "warn" : "error"}: ${text.slice(0, 200)}`);
      });
      page.on("pageerror", (error) => {
        add("runtime", `${error.name}: ${error.message.slice(0, 200)}`);
      });
      page.on("request", (request) => {
        const target = new URL(request.url());
        if (target.protocol !== "http:" && target.protocol !== "https:") return;
        if (target.origin !== origin)
          add("network", `request to another host: ${target.origin}${target.pathname}`);
      });
      page.on("requestfailed", (request) => {
        const reason = request.failure()?.errorText ?? "";
        // The app aborts on purpose: a cancelled or superseded run, or a stale
        // translation. An abort is the designed behaviour, not a failure.
        if (reason === "net::ERR_ABORTED") return;
        add("network", `request failed (${reason}): ${request.method()} ${request.url()}`);
      });
      page.on("response", (response) => {
        const status = response.status();
        if (status < 400 || isExpected(recorded, response.url(), status)) return;
        add(
          "network",
          `HTTP ${String(status)} not expected by the test: ${response.request().method()} ${response.url()}`,
        );
      });

      await page.exposeFunction("__ccGuardCls", (value: number, url: string, sources: string) => {
        if (value <= (recorded.cls.get(url) ?? 0)) return;
        recorded.cls.set(url, value);
        recorded.clsSources.set(url, sources);
      });
      await page.addInitScript(clsScript);

      const guard: Guard = {
        expectStatus: (url, status) => {
          recorded.expected.push({ url, status });
        },
        collect: () => runChecks(page, testInfo, recorded, origin),
        reset: () => {
          recorded.violations.length = 0;
          recorded.cls.clear();
          recorded.clsSources.clear();
        },
      };

      await use(guard);

      if (testInfo.status === "skipped") return;
      const violations = await runChecks(page, testInfo, recorded, origin);
      if (violations.length === 0) return;
      let shot: string | null = null;
      if (!page.isClosed()) {
        // Taken only on a finding, with the focus walk's focus cleared first.
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
        const dir = path.join(ROOT, "audit", "screens", "guard", testInfo.project.name);
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${slug(testInfo.titlePath.slice(1).join(" "))}.png`);
        await page.screenshot({ path: file, fullPage: true });
        shot = path.relative(ROOT, file).replace(/\\/g, "/");
      }
      await testInfo.attach("oddity-guard.json", {
        body: JSON.stringify(violations, null, 2),
        contentType: "application/json",
      });
      throw new Error(format(violations, shot));
    },
    { auto: true },
  ],
});

export { expect };
export type { Locator, Page, TestInfo } from "@playwright/test";
