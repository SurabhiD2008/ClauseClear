import { CHARS_PER_TOKEN } from "./constants.js";

/** Token estimate used everywhere a budget is checked: characters / 4, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
