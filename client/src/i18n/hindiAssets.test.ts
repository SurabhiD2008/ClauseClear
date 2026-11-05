import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVANAGARI_FACES, DEVANAGARI_FONT_WAIT_MS, loadDevanagariFonts } from "./hindiAssets";

describe("loadDevanagariFonts (prompt 18, audit item 2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for every Devanagari face with a Devanagari sample", async () => {
    const asked: [string, string | undefined][] = [];
    await loadDevanagariFonts({
      load: (font: string, text?: string) => {
        asked.push([font, text]);
        return Promise.resolve([]);
      },
    });
    expect(asked).toEqual(DEVANAGARI_FACES.map((face) => [face, "क"]));
  });

  it("gives up after the wait, so Hindi still shows if a font hangs", async () => {
    vi.useFakeTimers();
    let settled = false;
    const done = loadDevanagariFonts({ load: () => new Promise<FontFace[]>(() => undefined) }).then(
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(DEVANAGARI_FONT_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
  });

  it("a failed face is not an error", async () => {
    await expect(
      loadDevanagariFonts({ load: () => Promise.reject(new Error("blocked")) }),
    ).resolves.toBeUndefined();
  });

  it("does nothing without a font set (no DOM)", async () => {
    await expect(loadDevanagariFonts(undefined)).resolves.toBeUndefined();
  });
});
