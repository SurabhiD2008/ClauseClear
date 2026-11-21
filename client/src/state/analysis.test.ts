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
