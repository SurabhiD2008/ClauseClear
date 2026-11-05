import { afterEach, describe, expect, it, vi } from "vitest";
import fontsSource from "../styles/fonts.ts?raw";
import { FONT_WAIT_MS, LATIN_FACES, LATIN_SAMPLE, loadFaces, loadLatinFonts } from "./fonts";

describe("loadLatinFonts (prompt 18)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for every Latin face with a plain Latin sample, so no latin-ext file is awaited (A179)", async () => {
    const asked: [string, string | undefined][] = [];
    await loadLatinFonts({
      load: (font: string, text?: string) => {
        asked.push([font, text]);
        return Promise.resolve([]);
      },
    });
    expect(asked).toEqual(LATIN_FACES.map((face) => [face, LATIN_SAMPLE]));
    expect(/^[A-Za-z]+$/.test(LATIN_SAMPLE)).toBe(true);
  });

  it("lists exactly the faces styles/fonts.ts imports", () => {
    const imported = new Set(
      [
        ...fontsSource.matchAll(/@fontsource\/([\w-]+)\/(?:latin-(?:ext-)?)?(\d+)(-italic)?\.css/g),
      ].map(([, family = "", weight = "", italic]) => `${family} ${weight}${italic ?? ""}`),
    );
    const listed = new Set(
      LATIN_FACES.map((face) => {
        const m = /^(italic )?(\d+) 16px "(.+)"$/.exec(face);
        if (m === null) throw new Error(face);
        const family = (m[3] ?? "").toLowerCase().replace(/ /g, "-");
        return `${family} ${m[2] ?? ""}${m[1] === undefined ? "" : "-italic"}`;
      }),
    );
    expect([...listed].sort()).toEqual([...imported].sort());
  });

  it("gives up after the wait, so the page still shows if a font hangs", async () => {
    vi.useFakeTimers();
    let settled = false;
    const done = loadFaces(["400 16px X"], "a", {
      load: () => new Promise<FontFace[]>(() => undefined),
    }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
  });

  it("a failed face is not an error", async () => {
    await expect(
      loadLatinFonts({ load: () => Promise.reject(new Error("blocked")) }),
    ).resolves.toBeUndefined();
  });
});
