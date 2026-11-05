import { describe, expect, it } from "vitest";
import type { FlagKind, Severity } from "./schemas.js";
import { bandForScore, computeScore } from "./scoring.js";

interface Mix {
  high?: number;
  medium?: number;
  highMissing?: number;
  mediumMissing?: number;
}

/** Builds a flag list with the given mix of kinds and severities. */
function flags(mix: Mix): { kind: FlagKind; severity: Severity }[] {
  const make = (n: number | undefined, kind: FlagKind, severity: Severity) =>
    Array.from({ length: n ?? 0 }, () => ({ kind, severity }));
  return [
    ...make(mix.high, "present", "high"),
    ...make(mix.medium, "present", "medium"),
    ...make(mix.highMissing, "missing", "high"),
    ...make(mix.mediumMissing, "missing", "medium"),
  ];
}

describe("computeScore (SPEC section 6)", () => {
  // raw = 18*high + 8*medium + 10*highMissing + 5*mediumMissing, capped at 100
  const table: [string, Mix, number, "low" | "medium" | "high"][] = [
    ["no flags", {}, 0, "low"],
    ["one high flag", { high: 1 }, 18, "low"],
    ["one medium flag", { medium: 1 }, 8, "low"],
    ["one high missing item", { highMissing: 1 }, 10, "low"],
    ["one medium missing item", { mediumMissing: 1 }, 5, "low"],
    ["boundary 24: three medium flags", { medium: 3 }, 24, "low"],
    [
      "boundary 25: two high missing + one medium missing",
      { highMissing: 2, mediumMissing: 1 },
      25,
      "medium",
    ],
    [
      "1 high + 1 medium + 1 medium missing",
      { high: 1, medium: 1, mediumMissing: 1 },
      31,
      "medium",
    ],
    ["boundary 54: three high flags", { high: 3 }, 54, "medium"],
    [
      "boundary 55: 1 high + 4 medium + 1 medium missing",
      { high: 1, medium: 4, mediumMissing: 1 },
      55,
      "high",
    ],
    [
      "boundary 55: five high missing + one medium missing",
      { highMissing: 5, mediumMissing: 1 },
      55,
      "high",
    ],
    ["exactly 100: 5 high + 1 high missing", { high: 5, highMissing: 1 }, 100, "high"],
    ["capped at 100: six high flags (raw 108)", { high: 6 }, 100, "high"],
    [
      "capped at 100: everything",
      { high: 4, medium: 4, highMissing: 3, mediumMissing: 3 },
      100,
      "high",
    ],
  ];

  it.each(table.map(([name, mix, value, band]) => ({ name, mix, value, band })))(
    "$name -> $value ($band)",
    ({ mix, value, band }) => {
      const score = computeScore(flags(mix));
      expect(score.value).toBe(value);
      expect(score.band).toBe(band);
    },
  );

  it("counts present high, present medium, and all missing items", () => {
    const score = computeScore(flags({ high: 2, medium: 3, highMissing: 1, mediumMissing: 4 }));
    expect(score.counts).toEqual({ high: 2, medium: 3, missing: 5 });
  });

  it("ignores flag order", () => {
    const list = flags({ high: 1, medium: 2, mediumMissing: 1 });
    expect(computeScore([...list].reverse())).toEqual(computeScore(list));
  });
});

describe("bandForScore boundaries", () => {
  it.each([
    [0, "low"],
    [24, "low"],
    [25, "medium"],
    [54, "medium"],
    [55, "high"],
    [100, "high"],
  ] as const)("%i -> %s", (value, band) => {
    expect(bandForScore(value)).toBe(band);
  });
});
