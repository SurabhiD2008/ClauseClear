import { extractTranslatable, validResult } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { LONG_TEXT, flush, resultTitled, setupApp } from "../state/testing";
import { EMPTY_HINDI } from "../state/ui";
import { resultView } from "./translate";

async function finishedRun(setup: ReturnType<typeof setupApp>) {
  const done = setup.app.analysis.start({ kind: "text", text: LONG_TEXT });
  await flush();
  const run = setup.runs.at(-1);
  run?.emit({ type: "result", data: validResult() });
  run?.finish();
  await done;
}

const toHindi = async (setup: ReturnType<typeof setupApp>) => {
  setup.app.setLanguage("hi");
  await flush();
};

describe("Hindi for dynamic results", () => {
  it("samples use their precomputed Hindi with no translate call", async () => {
    const setup = setupApp();
    const open = setup.app.analysis.openSample("rental", { fresh: true });
    setup.samples[0]?.resolve({ en: validResult(), hi: { summary: "हिंदी सार" } });
    await open;
    await toHindi(setup);
    expect(setup.translations).toHaveLength(0);
    expect(setup.app.ui.getState().hindi).toEqual({
      status: "ready",
      strings: { summary: "हिंदी सार" },
      unchanged: [],
    });
  });

  it("a run's result is translated once, English stays meanwhile, and the cache is reused", async () => {
    const setup = setupApp();
    await finishedRun(setup);
    expect(setup.translations).toHaveLength(0); // English: no call
    await toHindi(setup);
    expect(setup.translations).toHaveLength(1);
    const request = setup.translations[0];
    if (request === undefined) throw new Error("no translate call");
    // Only translatable strings are sent: never quotes, segments or the title.
    expect(request.strings).toEqual(extractTranslatable(validResult()));

    const ui = setup.app.ui.getState();
    const during = resultView(validResult(), "hi", ui.hindi);
    expect(during).toMatchObject({ translating: true, translateFailed: false });
    expect(during.result.summary).toBe(validResult().summary);

    request.resolve({ strings: { summary: "हिंदी सार" }, unchanged: ["keyFacts.k1.value"] });
    await flush();
    const ready = resultView(validResult(), "hi", setup.app.ui.getState().hindi);
    expect(ready).toMatchObject({ translating: false, translateFailed: false });
    expect(ready.result.summary).toBe("हिंदी सार");
    expect(ready.result.flags[0]?.quote).toBe(validResult().flags[0]?.quote);

    setup.app.setLanguage("en");
    await toHindi(setup);
    expect(setup.translations).toHaveLength(1);
  });

  it("a result that arrives while the page is in Hindi is translated", async () => {
    const setup = setupApp();
    await toHindi(setup);
    await finishedRun(setup);
    expect(setup.translations).toHaveLength(1);
  });

  it("on failure English stays with a notice; a new toggle to Hindi retries", async () => {
    const setup = setupApp();
    await finishedRun(setup);
    await toHindi(setup);
    setup.translations[0]?.reject(new Error("503"));
    await flush();
    expect(setup.app.ui.getState().hindi.status).toBe("failed");
    const view = resultView(validResult(), "hi", setup.app.ui.getState().hindi);
    expect(view).toMatchObject({ translating: false, translateFailed: true });
    expect(view.result).toEqual(validResult());

    // Other store changes do not retry in a loop.
    setup.app.ui.selectFlag("f1");
    expect(setup.translations).toHaveLength(1);

    setup.app.setLanguage("en");
    await toHindi(setup);
    expect(setup.translations).toHaveLength(2);
  });

  it("a new analysis abandons a translation in flight and ignores its answer", async () => {
    const setup = setupApp();
    await finishedRun(setup);
    await toHindi(setup);
    const first = setup.translations[0];
    const open = setup.app.analysis.openSample("loan", { fresh: true });
    setup.samples[0]?.resolve({ en: resultTitled("Loan"), hi: { summary: "ऋण" } });
    await open;
    expect(first?.signal?.aborted).toBe(true);
    first?.resolve({ strings: { summary: "पुराना" }, unchanged: [] });
    await flush();
    expect(setup.app.ui.getState().hindi.strings).toEqual({ summary: "ऋण" });
  });

  it("in English the view is the English result, whatever the cache holds", () => {
    expect(resultView(validResult(), "en", EMPTY_HINDI)).toEqual({
      result: validResult(),
      translating: false,
      translateFailed: false,
    });
  });
});
