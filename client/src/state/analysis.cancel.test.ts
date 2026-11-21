import { validResult } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { LONG_TEXT, flush, resultTitled, setupApp } from "./testing";

const text = { kind: "text", text: LONG_TEXT } as const;

describe("cancel and the stale-run guard", () => {
  it("cancel aborts the request and resets run progress", async () => {
    const { app, runs } = setupApp();
    const done = app.analysis.start(text);
    await flush();
    runs[0]?.emit({ type: "status", data: { step: "analyzing" } });
    app.analysis.cancel();
    expect(runs[0]?.signal.aborted).toBe(true);
    const state = app.analysis.getState();
    expect(state.run.machine.status).toBe("cancelled");
    expect(state.run.progress).toBeNull();
    expect(await done).toBe(true);
    // The abort rejection is not reported as an error.
    expect(app.analysis.getState().error).toBeNull();
  });

  it("events that arrive after cancel are ignored", async () => {
    const { app, runs } = setupApp();
    void app.analysis.start(text);
    await flush();
    app.analysis.cancel();
    runs[0]?.emit({ type: "status", data: { step: "verifying" } });
    runs[0]?.emit({ type: "result", data: validResult() });
    runs[0]?.emit({ type: "error", data: { code: "ANALYSIS_FAILED", message: "x" } });
    await flush();
    const state = app.analysis.getState();
    expect(state.run.machine.status).toBe("cancelled");
    expect(state.current).toBeNull();
    expect(state.error).toBeNull();
  });

  it("start, cancel, start again: only the second run's result appears", async () => {
    const { app, runs } = setupApp();
    void app.analysis.start(text);
    await flush();
    app.analysis.cancel();
    const second = app.analysis.start(text);
    await flush();
    expect(runs).toHaveLength(2);
    expect(app.analysis.getState().run.machine.runId).toBe(2);

    // The first run's late events come in during the second run, then the second finishes.
    runs[0]?.emit({ type: "status", data: { step: "verifying" } });
    runs[0]?.emit({ type: "result", data: resultTitled("First run") });
    expect(app.analysis.getState().run.machine.status).toBe("reading");
    // The second run's progress line is not taken over by the first run's step.
    expect(app.analysis.getState().run.progress).toBeNull();
    expect(app.analysis.getState().current).toBeNull();

    runs[1]?.emit({ type: "result", data: resultTitled("Second run") });
    runs[0]?.emit({ type: "error", data: { code: "ANALYSIS_FAILED", message: "late" } });
    runs[1]?.finish();
    await second;
    const state = app.analysis.getState();
    expect(state.run.machine.status).toBe("done");
    expect(state.current?.result.title).toBe("Second run");
    expect(state.current?.analysisId).toBe("run:test-2");
    expect(state.error).toBeNull();
  });

  it("a stale failure from the first run cannot fail the second", async () => {
    const { app, runs } = setupApp();
    void app.analysis.start(text);
    await flush();
    app.analysis.cancel();
    void app.analysis.start(text);
    await flush();
    runs[0]?.fail(new ApiError({ code: "PROVIDER_UNAVAILABLE", message: "down" }));
    await flush();
    expect(app.analysis.getState().run.machine.status).toBe("reading");
    expect(app.analysis.getState().error).toBeNull();
  });
});

describe("samples", () => {
  const sample = () => ({ en: resultTitled("Sample lease"), hi: { summary: "सार" } });

  it("load without starting a run", async () => {
    const { app, runs, samples } = setupApp();
    const open = app.analysis.openSample("rental", { fresh: true });
    expect(app.analysis.getState().loadingSample).toBe("rental");
    samples[0]?.resolve(sample());
    await open;
    const state = app.analysis.getState();
    expect(runs).toHaveLength(0);
    expect(state.run.machine).toEqual({ status: "idle", runId: null });
    expect(state.loadingSample).toBeNull();
    expect(state.current).toMatchObject({
      source: "sample",
      sampleId: "rental",
      analysisId: "sample:rental",
    });
    expect(app.ui.getState().analysisId).toBe("sample:rental");
  });

  it("the last sample asked for wins", async () => {
    const { app, samples } = setupApp();
    const a = app.analysis.openSample("rental", { fresh: true });
    const b = app.analysis.openSample("loan", { fresh: true });
    expect(samples[0]?.signal?.aborted).toBe(true);
    samples[1]?.resolve({ ...sample(), en: resultTitled("Loan") });
    samples[0]?.resolve(sample());
    await Promise.all([a, b]);
    expect(app.analysis.getState().current?.result.title).toBe("Loan");
  });

  it("a page load of the sample already shown, or on its way, fetches nothing", async () => {
    const { app, samples } = setupApp();
    const open = app.analysis.openSample("rental", { fresh: true });
    void app.analysis.openSample("rental", { fresh: false });
    expect(samples).toHaveLength(1);
    samples[0]?.resolve(sample());
    await open;
    await app.analysis.openSample("rental", { fresh: false });
    expect(samples).toHaveLength(1);
  });

  it("opening a sample aborts an active run", async () => {
    const { app, runs, samples } = setupApp();
    void app.analysis.start(text);
    await flush();
    const open = app.analysis.openSample("rental", { fresh: false });
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(app.analysis.getState().run.machine.status).toBe("idle");
    runs[0]?.emit({ type: "result", data: resultTitled("Late run") });
    samples[0]?.resolve(sample());
    await open;
    expect(app.analysis.getState().current?.result.title).toBe("Sample lease");
  });

  it("a failed sample load keeps the error and starts nothing", async () => {
    const { app, samples } = setupApp();
    const open = app.analysis.openSample("nope", { fresh: false });
    samples[0]?.reject(new ApiError({ code: "NOT_FOUND", message: "Not found." }));
    await open;
    const state = app.analysis.getState();
    expect(state.sampleError?.code).toBe("NOT_FOUND");
    expect(state.current).toBeNull();
    expect(state.loadingSample).toBeNull();
  });
});
