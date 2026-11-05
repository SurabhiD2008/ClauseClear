import { TICKS_STORAGE_PREFIX } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { LONG_TEXT, flush, memorySession, resultTitled, setupApp } from "./testing";
import {
  INITIAL_RUN,
  INITIAL_UI,
  applyStateRule,
  createUiStore,
  type AppSnapshot,
  type UiState,
} from "./ui";

/** Every field away from its initial value, so a reset is visible. */
const BUSY_UI: UiState = {
  analysisId: "run:a",
  selectedFlagId: "f2",
  filter: "medium",
  sheetOpen: true,
  ticks: ["b1", "a1"],
  hindi: { status: "ready", strings: { summary: "सार" }, unchanged: [] },
};

function snapshot(status: "analyzing" | "done" = "analyzing"): AppSnapshot {
  return {
    lang: "hi",
    run: { machine: { status, runId: 4 }, progress: { step: "analyzing" } },
    ui: BUSY_UI,
  };
}

// SPEC section 9, "State rules": one test per row.
describe("the reset and keep table", () => {
  it("toggle language: resets nothing; keeps selected flag, filter, ticks, sheet and the rest", () => {
    const before = snapshot();
    const after = applyStateRule(before, { type: "LANGUAGE_TOGGLED", lang: "en" });
    expect(after.lang).toBe("en");
    expect(after.ui).toBe(before.ui);
    expect(after.run).toBe(before.run);
    // Toggling to the language already shown changes nothing at all.
    expect(applyStateRule(before, { type: "LANGUAGE_TOGGLED", lang: "hi" })).toBe(before);
  });

  it("new upload or sample: resets selected flag, filter, ticks, sheet and Hindi cache; keeps language", () => {
    const before = snapshot("done");
    const after = applyStateRule(before, { type: "NEW_ANALYSIS", analysisId: "run:b", ticks: [] });
    expect(after.ui).toEqual({ ...INITIAL_UI, analysisId: "run:b" });
    expect(after.lang).toBe("hi");
    expect(after.run).toBe(before.run);
  });

  it("new sample opened by its URL: the stored ticks for that id come back", () => {
    const after = applyStateRule(snapshot(), {
      type: "NEW_ANALYSIS",
      analysisId: "sample:rental",
      ticks: ["b2"],
    });
    expect(after.ui).toEqual({ ...INITIAL_UI, analysisId: "sample:rental", ticks: ["b2"] });
  });

  it("change filter: selected flag moves to the first visible; keeps ticks and language", () => {
    const before = snapshot("done");
    const after = applyStateRule(before, {
      type: "FILTER_CHANGED",
      filter: "high",
      firstVisibleFlagId: "f1",
    });
    expect(after.ui).toEqual({ ...BUSY_UI, filter: "high", selectedFlagId: "f1" });
    expect(after.ui.ticks).toBe(before.ui.ticks);
    expect(after.lang).toBe("hi");
    expect(after.run).toBe(before.run);
    // No flag at this level: nothing is selected ("No flags at this level.").
    const none = applyStateRule(before, {
      type: "FILTER_CHANGED",
      filter: "high",
      firstVisibleFlagId: null,
    });
    expect(none.ui.selectedFlagId).toBeNull();
  });

  it("cancel a run: resets run and progress; keeps language", () => {
    const before = snapshot("analyzing");
    const after = applyStateRule(before, { type: "RUN_CANCELLED" });
    expect(after.run).toEqual({ machine: { status: "cancelled", runId: 4 }, progress: null });
    expect(after.lang).toBe("hi");
    expect(after.ui).toBe(before.ui);
    // A run that is not active has nothing to cancel.
    const done = snapshot("done");
    expect(applyStateRule(done, { type: "RUN_CANCELLED" })).toBe(done);
  });

  it("go from results to checklist: resets nothing, keeps everything", () => {
    const before = snapshot("done");
    expect(applyStateRule(before, { type: "TO_CHECKLIST" })).toBe(before);
  });

  it("refresh on /results: resets everything; keeps language", () => {
    const after = applyStateRule(snapshot("done"), { type: "RESULTS_REFRESHED" });
    expect(after).toEqual({ lang: "hi", run: INITIAL_RUN, ui: INITIAL_UI });
  });
});

describe("the table through the live stores", () => {
  async function appWithSample(session = memorySession()) {
    const setup = setupApp(session);
    const open = setup.app.analysis.openSample("rental", { fresh: true });
    setup.samples[0]?.resolve({ en: resultTitled("Lease"), hi: {} });
    await open;
    return setup;
  }

  it("toggling language keeps selection, filter, ticks and sheet", async () => {
    const { app } = await appWithSample();
    app.changeFilter("medium");
    app.ui.setSheetOpen(true);
    app.ui.toggleTick("b1");
    const before = app.ui.getState();
    app.setLanguage("hi");
    await flush();
    expect(app.language.getState().lang).toBe("hi");
    expect(app.ui.getState()).toMatchObject({
      selectedFlagId: before.selectedFlagId,
      filter: "medium",
      sheetOpen: true,
      ticks: ["b1"],
    });
    app.setLanguage("en");
    expect(app.ui.getState().ticks).toEqual(["b1"]);
  });

  it("changing the filter selects the first visible flag in display order", async () => {
    const { app } = await appWithSample();
    // validResult: f1 high present, f2 medium present, f3 medium missing.
    app.changeFilter("medium");
    expect(app.ui.getState().selectedFlagId).toBe("f2");
    app.changeFilter("high");
    expect(app.ui.getState().selectedFlagId).toBe("f1");
    app.changeFilter("all");
    expect(app.ui.getState().selectedFlagId).toBe("f1");
  });

  it("ticks are kept in sessionStorage by analysis id, holding item ids only", async () => {
    const session = memorySession();
    const { app } = await appWithSample(session);
    app.ui.toggleTick("b1");
    app.ui.toggleTick("a1");
    app.ui.toggleTick("b1");
    expect(session.data.get(`${TICKS_STORAGE_PREFIX}sample:rental`)).toBe('["a1"]');
  });

  it("a page load of the sample restores its ticks; a fresh choice clears them", async () => {
    const session = memorySession({ [`${TICKS_STORAGE_PREFIX}sample:rental`]: '["b2"]' });
    const restored = setupApp(session);
    const open = restored.app.analysis.openSample("rental", { fresh: false });
    restored.samples[0]?.resolve({ en: resultTitled("Lease"), hi: {} });
    await open;
    expect(restored.app.ui.getState().ticks).toEqual(["b2"]);

    const fresh = await appWithSample(session);
    expect(fresh.app.ui.getState().ticks).toEqual([]);
    expect(session.data.has(`${TICKS_STORAGE_PREFIX}sample:rental`)).toBe(false);
  });

  it("a new run resets the UI state of the previous result", async () => {
    const { app } = await appWithSample();
    app.ui.selectFlag("f1");
    app.ui.toggleTick("b1");
    void app.analysis.start({ kind: "text", text: LONG_TEXT });
    expect(app.ui.getState()).toEqual({ ...INITIAL_UI, analysisId: "run:test-1" });
    expect(app.language.getState().lang).toBe("en");
  });

  it("cancel through the store resets run and progress only", async () => {
    const { app, runs } = await appWithSample();
    app.setLanguage("hi");
    await flush();
    void app.analysis.start({ kind: "text", text: LONG_TEXT });
    await flush();
    runs[0]?.emit({ type: "status", data: { step: "analyzing" } });
    const ui = app.ui.getState();
    app.analysis.cancel();
    expect(app.analysis.getState().run).toEqual({
      machine: { status: "cancelled", runId: 1 },
      progress: null,
    });
    expect(app.ui.getState()).toBe(ui);
    expect(app.language.getState().lang).toBe("hi");
  });
});

describe("the UI store", () => {
  it("ignores Hindi for an analysis that is no longer current", () => {
    const ui = createUiStore(null);
    ui.replace({ ...INITIAL_UI, analysisId: "run:b" });
    ui.setHindi("run:a", { status: "ready", strings: {}, unchanged: [] });
    expect(ui.getState().hindi.status).toBe("idle");
  });

  it("does not tick without an analysis, and survives blocked storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const ui = createUiStore(blocked);
    ui.toggleTick("b1");
    expect(ui.getState().ticks).toEqual([]);
    ui.replace({ ...INITIAL_UI, analysisId: "run:a" });
    ui.toggleTick("b1");
    expect(ui.getState().ticks).toEqual(["b1"]);
  });
});
