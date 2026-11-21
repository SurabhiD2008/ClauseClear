// axe accessibility findings, cached per identical page state.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { Violation } from "./types.js";

/**
 * axe takes seconds per page, and many tests end on the same page in the same
 * state. The same DOM at the same viewport gives the same result, so results
 * are kept per worker, keyed by project, address, language and a hash of the
 * markup. Any difference in the DOM means a fresh run.
 */
const axeCache = new Map<string, Violation[]>();

export async function axeFindings(page: Page, project: string): Promise<Violation[]> {
  const signature = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    let hash = 2166136261;
    for (let i = 0; i < html.length; i += 1) {
      hash ^= html.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${location.pathname}|${document.documentElement.lang}|${String(html.length)}|${String(hash >>> 0)}`;
  });
  const key = `${project}|${signature}`;
  const cached = axeCache.get(key);
  if (cached !== undefined) return cached;
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const found: Violation[] = [];
  for (const v of axe.violations) {
    if (v.impact !== "serious" && v.impact !== "critical") continue;
    const target = v.nodes[0]?.target.join(" ") ?? "";
    found.push({
      check: "axe",
      detail: `${v.id} (${v.impact}) on ${String(v.nodes.length)} node(s), first: ${target}`,
    });
  }
  axeCache.set(key, found);
  return found;
}
