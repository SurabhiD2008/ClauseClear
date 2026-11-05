import type { PipelineStep } from "@clauseclear/shared";

/** The four F4 labels, in order. Server steps map onto them as in ASSUMPTIONS A17. */
export const PROGRESS_LABELS = [
  "landing.stepReading",
  "landing.stepFinding",
  "landing.stepChecking",
  "landing.stepVerifying",
] as const;

const STEP_INDEX: Record<PipelineStep, number> = {
  reading: 0,
  segmenting: 1,
  detecting: 1,
  analyzing: 2,
  verifying: 3,
  scoring: 3,
};

/** Index into PROGRESS_LABELS; before the first status event the run is reading. */
export function progressIndex(step: PipelineStep | undefined): number {
  return step === undefined ? 0 : STEP_INDEX[step];
}
