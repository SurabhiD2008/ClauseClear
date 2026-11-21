// Shared by the flow specs: the phone-layout test, choosing a PDF, and a way to
// read the result the server streamed.
import path from "node:path";
import type { AnalysisResult } from "../../../shared/src/schemas.js";
import type { Page } from "../guard.js";
import { DOCS } from "./data.js";

export const phoneLayout = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

/**
 * The AnalysisResult the server streamed, read from the SSE body. The stream is
 * `no-store`, so Chromium drops its body once the app moves to /results and
 * `response.text()` fails; the page keeps a copy instead, through `clone()`, which
 * leaves the stream the app reads untouched.
 */
export async function streamedResult(
  page: Page,
  run: () => Promise<void>,
): Promise<AnalysisResult> {
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

export async function choosePdf(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a PDF" }).click();
  await (await chooser).setFiles(path.join(DOCS, file));
}
