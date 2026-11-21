// Language contracts shared by client and server.

export const LANGS = ["en", "hi"] as const;
export type Lang = (typeof LANGS)[number];

/** First visit is always English, whatever the browser language. */
export const DEFAULT_LANG: Lang = "en";

/** localStorage key for the user's language choice. */
export const LANG_STORAGE_KEY = "cc.lang";

/** Any Devanagari character. Used by the language rule tests and the NOT_ENGLISH check. */
export const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "hi";
}

/** Every dotted path to a string leaf in a nested message object, e.g. "header.navHow". */
export type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, unknown>
      ? `${K}.${DotPaths<T[K]>}`
      : never;
}[keyof T & string];
