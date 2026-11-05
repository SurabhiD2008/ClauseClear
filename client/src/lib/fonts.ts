/** Longest wait for a set of faces before the text shows anyway, with font-display: swap. */
export const FONT_WAIT_MS = 3_000;

/**
 * Loads font faces before the text that uses them goes on screen. Otherwise the
 * text first draws in a fallback font and moves when the real one swaps in, and
 * a move more than 500 ms after the last input counts as layout shift (prompt
 * 18, audit item 2). Resolves when every face has loaded or failed, or after
 * `waitMs`, so a hanging font never keeps the page from showing.
 */
export async function loadFaces(
  faces: readonly string[],
  sample: string,
  fonts: Pick<FontFaceSet, "load"> | undefined = typeof document === "undefined"
    ? undefined
    : document.fonts,
  waitMs = FONT_WAIT_MS,
): Promise<void> {
  if (fonts === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  // A face that fails to load is not an error: the text still shows, in the fallback.
  const loaded = Promise.all(faces.map((face) => fonts.load(face, sample))).then(
    () => undefined,
    () => undefined,
  );
  await Promise.race([loaded, timeout]);
  clearTimeout(timer);
}

/** Text for fonts.load: only the Latin subset files, which the build preloads. */
export const LATIN_SAMPLE = "Aa";

/** Every Latin face in styles/fonts.ts, as CSS font shorthands. */
export const LATIN_FACES = [
  '800 16px "Archivo"',
  '900 16px "Archivo"',
  '400 16px "Source Serif 4"',
  'italic 400 16px "Source Serif 4"',
  '600 16px "Source Serif 4"',
  '500 16px "IBM Plex Mono"',
  '600 16px "IBM Plex Mono"',
  '700 16px "IBM Plex Mono"',
  '400 16px "Kalam"',
  '700 16px "Kalam"',
];

/**
 * The first render waits for the Latin faces (they are preloaded, so this is
 * usually immediate). Under load a face could still arrive after the first
 * paint, and the swap moved the results page by 36 px (prompt 18). The sample is
 * plain Latin: it once included the rupee sign, which sits in every face's
 * latin-ext subset, so the first render also waited for eight latin-ext files
 * that no page uses (no shown text needs a latin-ext glyph; prompt 19, A179).
 */
export function loadLatinFonts(
  fonts?: Pick<FontFaceSet, "load">,
  waitMs = FONT_WAIT_MS,
): Promise<void> {
  return loadFaces(
    LATIN_FACES,
    LATIN_SAMPLE,
    fonts ?? (typeof document === "undefined" ? undefined : document.fonts),
    waitMs,
  );
}
