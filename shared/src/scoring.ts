import {
  SCORE_BAND_HIGH_FROM,
  SCORE_BAND_MEDIUM_FROM,
  SCORE_MAX,
  SCORE_WEIGHTS,
} from "./constants.js";
import type { FlagKind, ScoreBand, Severity } from "./schemas.js";

export interface ScoredFlag {
  kind: FlagKind;
  severity: Severity;
}

export interface Score {
  value: number;
  band: ScoreBand;
  counts: { high: number; medium: number; missing: number };
}

export function bandForScore(value: number): ScoreBand {
  if (value < SCORE_BAND_MEDIUM_FROM) return "low";
  if (value < SCORE_BAND_HIGH_FROM) return "medium";
  return "high";
}

/**
 * The only scoring function (SPEC section 6). The model never outputs a score;
 * server, client and the schema check all call this.
 * counts.high and counts.medium count present flags; counts.missing counts every missing item.
 */
export function computeScore(flags: readonly ScoredFlag[]): Score {
  let high = 0;
  let medium = 0;
  let highMissing = 0;
  let mediumMissing = 0;
  for (const flag of flags) {
    if (flag.kind === "present") {
      if (flag.severity === "high") high += 1;
      else medium += 1;
    } else if (flag.severity === "high") {
      highMissing += 1;
    } else {
      mediumMissing += 1;
    }
  }
  const raw =
    SCORE_WEIGHTS.highFlag * high +
    SCORE_WEIGHTS.mediumFlag * medium +
    SCORE_WEIGHTS.highMissing * highMissing +
    SCORE_WEIGHTS.mediumMissing * mediumMissing;
  const value = Math.min(SCORE_MAX, raw);
  return {
    value,
    band: bandForScore(value),
    counts: { high, medium, missing: highMissing + mediumMissing },
  };
}
