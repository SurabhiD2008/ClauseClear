import { describe, expect, it } from "vitest";
import { canHover } from "./hover";

describe("canHover (prompt 18)", () => {
  it("asks for (hover: hover) and follows the answer", () => {
    const asked: string[] = [];
    const media = (matches: boolean) => (query: string) => {
      asked.push(query);
      return { matches };
    };
    expect(canHover(media(true))).toBe(true);
    expect(canHover(media(false))).toBe(false);
    expect(asked).toEqual(["(hover: hover)", "(hover: hover)"]);
  });

  it("is false without a window (no DOM)", () => {
    expect(canHover(undefined)).toBe(false);
  });
});
