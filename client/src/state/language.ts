// The language store (SPEC section 9): English by default, the choice persisted
// in localStorage under cc.lang, <html lang> kept in sync, and Hindi strings plus
// Devanagari fonts loaded on first use. Separate from the analysis and UI stores.
import { DEFAULT_LANG, LANG_STORAGE_KEY, type Lang } from "@clauseclear/shared";
import { EN, type Messages } from "../i18n/messages";

export interface LanguageState {
  lang: Lang;
  messages: Messages;
  /** Hindi is being fetched; English stays on screen meanwhile. */
  loading: boolean;
  /** The last Hindi load failed; the page stays English and says so. */
  failed: boolean;
}

export interface LanguageDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  root: { lang: string } | null;
  loadHindi: () => Promise<Messages>;
}

export interface LanguageStore {
  getState: () => LanguageState;
  subscribe: (listener: () => void) => () => void;
  setLanguage: (lang: Lang) => Promise<void>;
  /**
   * Restores a saved choice. Never reads the browser language. Resolves once a
   * saved Hindi choice is applied (or has failed), so the first render can wait
   * for it instead of painting English and then swapping (prompt 18).
   */
  init: () => Promise<void>;
}

const ENGLISH: LanguageState = { lang: DEFAULT_LANG, messages: EN, loading: false, failed: false };

export function createLanguageStore(deps: LanguageDeps): LanguageStore {
  let state = ENGLISH;
  let hindi: Messages | null = null;
  // Each call gets an id; only the latest call may change the language, so a
  // slow Hindi load cannot override a later switch back to English.
  let latest = 0;
  const listeners = new Set<() => void>();

  const set = (next: LanguageState) => {
    state = next;
    if (deps.root !== null) deps.root.lang = next.lang;
    for (const listener of listeners) listener();
  };

  const persist = (lang: Lang) => {
    try {
      deps.storage?.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // Storage can be blocked (private mode, disabled site data). The choice
      // still applies for this page view; nothing else depends on it.
    }
  };

  const setLanguage = async (lang: Lang): Promise<void> => {
    const id = ++latest;
    if (lang === "en") {
      set(ENGLISH);
      persist("en");
      return;
    }
    if (hindi === null) {
      set({ ...state, loading: true, failed: false });
      try {
        hindi = await deps.loadHindi();
      } catch {
        if (id === latest) set({ ...ENGLISH, failed: true });
        return;
      }
    }
    if (id !== latest) return;
    set({ lang: "hi", messages: hindi, loading: false, failed: false });
    persist("hi");
  };

  const init = (): Promise<void> => {
    let saved: string | null = null;
    try {
      saved = deps.storage?.getItem(LANG_STORAGE_KEY) ?? null;
    } catch {
      // Unreadable storage means no saved choice: start in English.
    }
    if (saved === "hi") return setLanguage("hi");
    if (deps.root !== null) deps.root.lang = DEFAULT_LANG;
    return Promise.resolve();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLanguage,
    init,
  };
}

function browserStorage(): LanguageDeps["storage"] {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const languageStore = createLanguageStore({
  storage: typeof window === "undefined" ? null : browserStorage(),
  root: typeof document === "undefined" ? null : document.documentElement,
  // The strings and the font faces arrive together, so Hindi never re-lays out
  // when its fonts swap in (prompt 18).
  loadHindi: () =>
    import("../i18n/hindiAssets").then(async (module) => {
      await module.loadDevanagariFonts();
      return module.HI;
    }),
});
