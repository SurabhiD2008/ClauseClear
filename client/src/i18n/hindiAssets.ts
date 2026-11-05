// Loaded only by a dynamic import on the first toggle to Hindi, so Vite puts the
// Hindi strings and the Devanagari font faces in their own chunk (SPEC section 9).
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";
import "@fontsource/noto-sans-devanagari/devanagari-800.css";
import "@fontsource/noto-serif-devanagari/devanagari-400.css";
import "@fontsource/noto-serif-devanagari/devanagari-600.css";
import "@fontsource/kalam/devanagari-400.css";
import "@fontsource/kalam/devanagari-700.css";
import { FONT_WAIT_MS, loadFaces } from "../lib/fonts";
import hi from "./hi.json";
import type { Messages } from "./messages";

// Typed as Messages, so a key missing from hi.json fails the typecheck.
export const HI: Messages = hi;

/** Every Devanagari face imported above, as CSS font shorthands. */
export const DEVANAGARI_FACES = [
  '400 16px "Noto Sans Devanagari"',
  '600 16px "Noto Sans Devanagari"',
  '700 16px "Noto Sans Devanagari"',
  '800 16px "Noto Sans Devanagari"',
  '400 16px "Noto Serif Devanagari"',
  '600 16px "Noto Serif Devanagari"',
  '400 16px "Kalam"',
  '700 16px "Kalam"',
];

/** Longest wait for the faces before Hindi shows anyway, with font-display: swap. */
export const DEVANAGARI_FONT_WAIT_MS = FONT_WAIT_MS;

/**
 * Loads the Devanagari faces before the Hindi strings go on screen, so Hindi
 * never moves when its fonts swap in (prompt 18, audit item 2). English stays on
 * screen with "Loading Hindi…" meanwhile.
 */
export function loadDevanagariFonts(
  fonts: Pick<FontFaceSet, "load"> | undefined = typeof document === "undefined"
    ? undefined
    : document.fonts,
  waitMs = DEVANAGARI_FONT_WAIT_MS,
): Promise<void> {
  return loadFaces(DEVANAGARI_FACES, "क", fonts, waitMs);
}
