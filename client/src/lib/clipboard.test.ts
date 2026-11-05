import { describe, expect, it, vi } from "vitest";
import { copyText, numberedList, type ClipboardEnv } from "./clipboard";

function fakeDocument(execResult: boolean | "throw") {
  const area = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
  };
  const focus = vi.fn();
  const doc = {
    activeElement: { focus },
    createElement: vi.fn(() => area),
    execCommand: vi.fn(() => {
      if (execResult === "throw") throw new Error("blocked");
      return execResult;
    }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  };
  return { doc: doc as unknown as ClipboardEnv["document"], area, focus, raw: doc };
}

describe("copyText", () => {
  it("uses the Clipboard API when it works", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const { doc, raw } = fakeDocument(true);
    expect(await copyText("hello", { clipboard: { writeText }, document: doc })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(raw.execCommand).not.toHaveBeenCalled();
  });

  it("falls back to a textarea when the Clipboard API rejects", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    const { doc, area, focus, raw } = fakeDocument(true);
    expect(await copyText("hello", { clipboard: { writeText }, document: doc })).toBe(true);
    expect(area.value).toBe("hello");
    expect(raw.execCommand).toHaveBeenCalledWith("copy");
    expect(raw.body.appendChild).toHaveBeenCalledWith(area);
    expect(raw.body.removeChild).toHaveBeenCalledWith(area);
    // Focus goes back to the button that was pressed.
    expect(focus).toHaveBeenCalled();
  });

  it("falls back when there is no Clipboard API at all", async () => {
    const { doc, raw } = fakeDocument(true);
    expect(await copyText("x", { clipboard: undefined, document: doc })).toBe(true);
    expect(raw.execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when both routes fail, and still cleans up", async () => {
    for (const result of [false, "throw"] as const) {
      const { doc, area, raw } = fakeDocument(result);
      expect(await copyText("x", { clipboard: undefined, document: doc })).toBe(false);
      expect(raw.body.removeChild).toHaveBeenCalledWith(area);
    }
  });
});

describe("numberedList", () => {
  it("numbers each item on its own line", () => {
    expect(numberedList(["One?", "Two?"])).toBe("1. One?\n2. Two?");
    expect(numberedList([])).toBe("");
  });
});
