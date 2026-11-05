import { MAX_FILE_BYTES, MAX_TEXT_CHARS, validResult } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { validateInput } from "./analysis";
import { LONG_TEXT, flush, resultTitled, setupApp } from "./testing";

const text = { kind: "text", text: LONG_TEXT } as const;

describe("a run through the analysis store", () => {
  it("goes idle → validating → reading → analyzing → verifying → done", async () => {
    const { app, runs } = setupApp();
    const seen: string[] = [];
    app.analysis.subscribe(() => {
      const { status } = app.analysis.getState().run.machine;
      if (seen.at(-1) !== status) seen.push(status);
    });

    const started = app.analysis.start(text);
    expect(app.analysis.getState().run.machine.status).toBe("validating");
    await flush();
    const run = runs[0];
    if (run === undefined) throw new Error("no request sent");
    run.emit({ type: "status", data: { step: "reading" } });
    run.emit({ type: "status", data: { step: "detecting" } });
    run.emit({ type: "status", data: { step: "analyzing", detail: "reading the whole document" } });
    expect(app.analysis.getState().run.progress).toEqual({
      step: "analyzing",
      detail: "reading the whole document",
    });
    run.emit({ type: "status", data: { step: "scoring" } });
    run.emit({ type: "result", data: validResult() });
    run.finish();
    expect(await started).toBe(true);

    expect(seen).toEqual(["validating", "reading", "analyzing", "verifying", "done"]);
    const state = app.analysis.getState();
    expect(state.run.progress).toBeNull();
    expect(state.current).toEqual({
      source: "run",
      analysisId: "run:test-1",
      result: validResult(),
      fileName: null,
      input: text,
    });
    expect(app.ui.getState().analysisId).toBe("run:test-1");
  });

  it("refuses illegal events: steps never go back, nothing moves a finished run", async () => {
    const { app, runs } = setupApp();
    void app.analysis.start(text);
    await flush();
    const run = runs[0];
    if (run === undefined) throw new Error("no request sent");
    run.emit({ type: "status", data: { step: "verifying" } });
    run.emit({ type: "status", data: { step: "reading" } });
    expect(app.analysis.getState().run.machine.status).toBe("verifying");

    run.emit({ type: "result", data: resultTitled("First") });
    run.emit({ type: "status", data: { step: "analyzing" } });
    run.emit({ type: "result", data: resultTitled("Second") });
    run.emit({ type: "error", data: { code: "ANALYSIS_FAILED", message: "late" } });
    run.finish();
    await flush();
    const state = app.analysis.getState();
    expect(state.run.machine.status).toBe("done");
    expect(state.current?.result.title).toBe("First");
    expect(state.error).toBeNull();

    app.analysis.cancel();
    expect(app.analysis.getState().run.machine.status).toBe("done");
  });

  it("prevents a double submit: a second start while active sends nothing", async () => {
    const { app, runs } = setupApp();
    const first = app.analysis.start(text);
    expect(await app.analysis.start(text)).toBe(false);
    await flush();
    expect(await app.analysis.start(text)).toBe(false);
    expect(runs).toHaveLength(1);
    expect(app.analysis.getState().run.machine.runId).toBe(1);
    runs[0]?.emit({ type: "result", data: validResult() });
    runs[0]?.finish();
    expect(await first).toBe(true);
    // Once the run is over, a new one may start.
    void app.analysis.start(text);
    await flush();
    expect(runs).toHaveLength(2);
  });

  it("an error event fails the run with the server's body", async () => {
    const { app, runs } = setupApp();
    const done = app.analysis.start(text);
    await flush();
    runs[0]?.emit({
      type: "error",
      data: { code: "RATE_LIMITED", message: "Too many requests.", retryAfterSec: 30 },
    });
    runs[0]?.finish();
    await done;
    const state = app.analysis.getState();
    expect(state.run.machine.status).toBe("error");
    expect(state.error).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests.",
      retryAfterSec: 30,
    });
    expect(state.current).toBeNull();
  });

  it("an HTTP error before the stream uses the ApiError body", async () => {
    const { app, runs } = setupApp();
    const done = app.analysis.start(text);
    await flush();
    runs[0]?.fail(new ApiError({ code: "NOT_ENGLISH", message: "English only." }));
    await done;
    expect(app.analysis.getState().error?.code).toBe("NOT_ENGLISH");
  });

  it("a stream that ends with no result, or a network failure, is ANALYSIS_FAILED", async () => {
    const { app, runs } = setupApp();
    let done = app.analysis.start(text);
    await flush();
    runs[0]?.emit({ type: "status", data: { step: "reading" } });
    runs[0]?.finish();
    await done;
    expect(app.analysis.getState().error?.code).toBe("ANALYSIS_FAILED");

    done = app.analysis.start(text);
    await flush();
    runs[1]?.fail(new TypeError("Failed to fetch"));
    await done;
    expect(app.analysis.getState().run.machine.status).toBe("error");
    expect(app.analysis.getState().error?.code).toBe("ANALYSIS_FAILED");
  });

  it("client validation fails fast and sends nothing", async () => {
    const { app, runs } = setupApp();
    await app.analysis.start({ kind: "text", text: "too short" });
    expect(app.analysis.getState().run.machine.status).toBe("error");
    expect(app.analysis.getState().error?.code).toBe("TEXT_TOO_SHORT");
    expect(runs).toHaveLength(0);
  });
});

describe("validateInput (the server's checks, repeated)", () => {
  const file = (bytes: BlobPart) => new Blob([bytes]);

  it.each([
    ["short text", { kind: "text", text: "a".repeat(199) }, "TEXT_TOO_SHORT"],
    ["whitespace", { kind: "text", text: " ".repeat(500) }, "TEXT_TOO_SHORT"],
    ["long text", { kind: "text", text: "a".repeat(MAX_TEXT_CHARS + 1) }, "TEXT_TOO_LONG"],
    ["Devanagari", { kind: "text", text: `${LONG_TEXT} किराया` }, "NOT_ENGLISH"],
    ["empty file", { kind: "file", file: file("") }, "BAD_REQUEST"],
    ["not a PDF", { kind: "file", file: file("hello, this is text") }, "NOT_PDF"],
    [
      "big file",
      { kind: "file", file: file(new Uint8Array(MAX_FILE_BYTES + 1)) },
      "FILE_TOO_LARGE",
    ],
  ] as const)("%s → %s", async (_name, input, code) => {
    expect((await validateInput(input))?.code).toBe(code);
  });

  it("accepts 200 characters of English and a file starting with %PDF", async () => {
    expect(await validateInput({ kind: "text", text: "a".repeat(200) })).toBeNull();
    expect(await validateInput({ kind: "file", file: file("%PDF-1.7\n...") })).toBeNull();
  });
});

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
