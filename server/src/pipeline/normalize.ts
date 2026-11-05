// SPEC section 6 step 3. The viewer shows this text and every later match
// (quotes, numbers, glossary terms) is made against it, so the steps run in a
// fixed order and the function is pure: the same input always gives the same
// output.
//
//   1. Unicode NFKC (ligatures such as "ﬁ" become "fi", no-break spaces become spaces)
//   2. Remove control and invisible format characters, keeping line breaks
//   3. Unify quote marks to ' and "
//   4. Rejoin words hyphenated across a line break ("indem-\nnify" -> "indemnify")
//   5. Collapse runs of spaces and tabs; trim each line
//   6. Keep paragraph breaks: at most one blank line between paragraphs

/** C0/C1 controls except \n, plus soft hyphen, zero-width characters, BOM and bidi marks. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u2035`]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u2036\u00AB\u00BB]/g;
/**
 * A letter, a hyphen at the end of a line, then a lowercase letter starting the
 * next line: a word broken by layout, so the hyphen goes. The hyphen stays when
 * the next part is capitalised or a number ("Pre-\nConstruction"), and after the
 * whole words "self", "non" and "quasi", which in contracts almost always start a
 * real compound ("self-\nemployed", "non-\nrefundable"). The line break itself
 * is removed in both cases. The look-behind anchors the match at the start of
 * a word, which keeps the scan linear on long runs of letters.
 */
const LINE_BREAK_HYPHEN = /(?<!\p{L})(\p{L}+)-[ \t]*\n[ \t]*(?=\p{Ll})/gu;
const KEEP_HYPHEN = new Set(["self", "non", "quasi"]);

export function normalizeText(input: string): string {
  return (
    input
      .normalize("NFKC")
      // Windows and old Mac line endings first, so step 2 can drop every other control.
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      .replace(INVISIBLE, "")
      .replace(SINGLE_QUOTES, "'")
      .replace(DOUBLE_QUOTES, '"')
      .replace(LINE_BREAK_HYPHEN, (_match, word: string) =>
        KEEP_HYPHEN.has(word.toLowerCase()) ? `${word}-` : word,
      )
      .replace(/ +/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
