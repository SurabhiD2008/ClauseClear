import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./guard.js";
import type { AnalysisResult, Flag } from "../../shared/src/schemas.js";

// Prompt 14: read aloud (SPEC F15, section 9) with a stubbed speechSynthesis, so
// the tests hear exactly what would be spoken and in which locale.
const ROOT = process.cwd();
const sample = JSON.parse(
  readFileSync(path.join(ROOT, "fixtures/samples/rental.json"), "utf8"),
) as { en: AnalysisResult; hi: Record<string, string> };
const rental = sample.en;

function ranked(flags: readonly Flag[]): Flag[] {
  const rank = (f: Flag) => (f.kind === "missing" ? 2 : f.severity === "high" ? 0 : 1);
  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.i - b.i)
    .map(({ flag }) => flag);
}
const first = ranked(rental.flags)[0];
if (first === undefined) throw new Error("no flags");

test.use({ reducedMotion: "reduce" });

interface Spoken {
  text: string;
  lang: string;
  voice: string | null;
}

/** Replaces speechSynthesis before the page loads. voices: locales to offer, or null for none at all. */
async function stubSpeech(page: Page, voices: string[] | null) {
  await page.addInitScript((locales) => {
    const w = window as unknown as {
      spoken: Spoken[];
      cancels: number;
      utterances: EventTarget[];
    };
    w.spoken = [];
    w.cancels = 0;
    w.utterances = [];
    if (locales === null) {
      // As in a browser without the Web Speech API.
      Reflect.deleteProperty(Window.prototype, "speechSynthesis");
      Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
      return;
    }
    const list = locales.map((lang) => ({ lang, name: `Stub ${lang}` }));
    const synth = Object.assign(new EventTarget(), {
      getVoices: () => list,
      speak: (u: { text: string; lang: string; voice: { lang: string } | null }) => {
        w.spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.lang ?? null });
      },
      cancel: () => {
        w.cancels += 1;
      },
    });
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    class Utterance extends EventTarget {
      lang = "";
      voice: unknown = null;
      constructor(public text: string) {
        super();
        w.utterances.push(this);
      }
    }
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      Utterance;
  }, voices);
}

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { spoken: Spoken[] }).spoken);
const cancels = (page: Page) =>
  page.evaluate(() => (window as unknown as { cancels: number }).cancels);

async function openSample(page: Page) {
  await page.goto("/results/sample/rental");
  await expect(page.getByRole("heading", { level: 1, name: "What this says" })).toBeVisible();
}

test("Listen reads the summary in en-IN, shows Stop, and Stop cancels", async ({ page }) => {
  await stubSpeech(page, ["en-US", "en-IN", "hi-IN"]);
  await openSample(page);
  const listen = page.getByRole("button", { name: "Listen to the summary" });
  await listen.click();
  expect(await spoken(page)).toEqual([{ text: rental.summary, lang: "en-IN", voice: "en-IN" }]);
  const stop = page.locator(".cc-verdict").getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  const before = await cancels(page);
  await stop.click();
  expect(await cancels(page)).toBeGreaterThan(before);
  await expect(listen).toBeVisible();

  // The end of the speech also brings Listen back.
  await listen.click();
  await expect(stop).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { utterances: EventTarget[] };
    w.utterances.at(-1)?.dispatchEvent(new Event("end"));
  });
  await expect(listen).toBeVisible();
});

test("an open flag reads its title and explanation, and closing it stops the reading", async ({
  page,
}) => {
  await stubSpeech(page, ["en-IN", "hi-IN"]);
  await openSample(page);
  const head = page.locator(`[data-flag-id="${first.id}"] .cc-flag__head`);
  await head.click();
  if ((await page.locator("dialog.cc-sheet-dialog[open]").count()) > 0) {
    await page.keyboard.press("Escape");
  }
  // Only the open flag has the button.
  await expect(page.getByRole("button", { name: "Listen to this flag" })).toHaveCount(1);
  await page.getByRole("button", { name: "Listen to this flag" }).click();
  const [said] = await spoken(page);
  expect(said).toEqual({
    text: `${first.title}. ${first.plain} ${first.why}`,
    lang: "en-IN",
    voice: "en-IN",
  });
  await expect(
    page.locator(`[data-flag-id="${first.id}"]`).getByRole("button", { name: "Stop" }),
  ).toBeVisible();
  const before = await cancels(page);
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  expect(await cancels(page)).toBeGreaterThan(before);
});

test("in Hindi, Listen reads the Hindi summary in hi-IN", async ({ page }) => {
  await stubSpeech(page, ["en-IN", "hi-IN"]);
  await openSample(page);
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  const listen = page.locator(".cc-verdict .cc-read");
  await expect(listen).toHaveText("सारांश सुनें");
  await listen.click();
  expect(await spoken(page)).toEqual([{ text: sample.hi.summary, lang: "hi-IN", voice: "hi-IN" }]);
  await expect(listen).toHaveText("रोकें");
});

test("with no voice for the language, a hint replaces the button", async ({ page }) => {
  await stubSpeech(page, ["en-IN"]);
  await openSample(page);
  await expect(page.getByRole("button", { name: "Listen to the summary" })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: /^HI/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.locator(".cc-verdict .cc-read")).toHaveCount(0);
  await expect(page.locator(".cc-verdict").getByTestId("read-aloud-hint")).toHaveText(
    "पढ़कर सुनाने के लिए इस भाषा की आवाज़ चाहिए, जो इंस्टॉल नहीं है।",
  );
});

test("with no voices installed, the hint shows once the voice list has had time to load", async ({
  page,
}) => {
  await stubSpeech(page, []);
  await openSample(page);
  await expect(page.locator(".cc-verdict").getByTestId("read-aloud-hint")).toHaveText(
    "Read aloud needs a voice for this language, and none is installed.",
  );
  await expect(page.getByRole("button", { name: "Listen to the summary" })).toHaveCount(0);
});

test("without speech synthesis, the hint says the browser can't read aloud", async ({ page }) => {
  await stubSpeech(page, null);
  await openSample(page);
  expect(await page.evaluate(() => typeof window.speechSynthesis)).toBe("undefined");
  await expect(page.locator(".cc-verdict").getByTestId("read-aloud-hint")).toHaveText(
    "This browser can’t read aloud.",
  );
  await expect(page.getByRole("button", { name: "Listen to the summary" })).toHaveCount(0);
});
