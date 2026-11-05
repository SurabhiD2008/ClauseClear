import { LANG_STORAGE_KEY } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import hi from "../i18n/hi.json";
import type { Messages } from "../i18n/messages";
import { createLanguageStore, type LanguageDeps } from "./language";

const HI: Messages = hi;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function setup(overrides: Partial<LanguageDeps> = {}, saved: Record<string, string> = {}) {
  const storage = memoryStorage(saved);
  const root = { lang: "" };
  let loads = 0;
  const store = createLanguageStore({
    storage,
    root,
    loadHindi: () => {
      loads += 1;
      return Promise.resolve(HI);
    },
    ...overrides,
  });
  return { store, storage, root, loads: () => loads };
}

describe("language store", () => {
  it("defaults to English and does not load Hindi", () => {
    const { store, root, loads } = setup();
    void store.init();
    expect(store.getState().lang).toBe("en");
    expect(store.getState().messages).toBe(en);
    expect(root.lang).toBe("en");
    expect(loads()).toBe(0);
  });

  it("toggling to Hindi loads it, sets html lang and persists cc.lang", async () => {
    const { store, storage, root, loads } = setup();
    await store.setLanguage("hi");
    expect(store.getState()).toMatchObject({ lang: "hi", loading: false, failed: false });
    expect(store.getState().messages).toBe(HI);
    expect(root.lang).toBe("hi");
    expect(storage.data.get(LANG_STORAGE_KEY)).toBe("hi");
    expect(loads()).toBe(1);
  });

  it("toggling back to English sets html lang and persists, and Hindi loads only once", async () => {
    const { store, storage, root, loads } = setup();
    await store.setLanguage("hi");
    await store.setLanguage("en");
    expect(root.lang).toBe("en");
    expect(storage.data.get(LANG_STORAGE_KEY)).toBe("en");
    await store.setLanguage("hi");
    expect(loads()).toBe(1);
  });

  it("notifies subscribers on every change", async () => {
    const { store } = setup();
    let calls = 0;
    const unsubscribe = store.subscribe(() => (calls += 1));
    await store.setLanguage("hi");
    unsubscribe();
    await store.setLanguage("en");
    expect(calls).toBe(2); // loading, then loaded
  });

  it("init restores a saved Hindi choice", async () => {
    const { store, root } = setup({}, { [LANG_STORAGE_KEY]: "hi" });
    void store.init();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().lang).toBe("hi");
    expect(root.lang).toBe("hi");
  });

  it("init resolves only once a saved Hindi choice is applied, so the first render can wait (prompt 18)", async () => {
    let finish: (m: Messages) => void = () => undefined;
    const pending = new Promise<Messages>((resolve) => {
      finish = resolve;
    });
    const { store } = setup({ loadHindi: () => pending }, { [LANG_STORAGE_KEY]: "hi" });
    let done = false;
    const ready = store.init().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(store.getState().lang).toBe("en");
    finish(HI);
    await ready;
    expect(store.getState().lang).toBe("hi");
  });

  it("init resolves at once without a saved choice", async () => {
    const { store } = setup();
    await expect(store.init()).resolves.toBeUndefined();
    expect(store.getState().lang).toBe("en");
  });

  it("init ignores an unknown saved value", () => {
    const { store, root, loads } = setup({}, { [LANG_STORAGE_KEY]: "fr" });
    void store.init();
    expect(store.getState().lang).toBe("en");
    expect(root.lang).toBe("en");
    expect(loads()).toBe(0);
  });

  it("a failed Hindi load keeps English and sets failed", async () => {
    const { store, storage, root } = setup({
      loadHindi: () => Promise.reject(new Error("offline")),
    });
    await store.setLanguage("hi");
    expect(store.getState()).toMatchObject({ lang: "en", loading: false, failed: true });
    expect(root.lang).toBe("en");
    expect(storage.data.has(LANG_STORAGE_KEY)).toBe(false);
  });

  it("a slow Hindi load cannot override a later switch to English", async () => {
    let resolve: (messages: Messages) => void = () => undefined;
    const { store, root } = setup({
      loadHindi: () => new Promise<Messages>((done) => (resolve = done)),
    });
    const pending = store.setLanguage("hi");
    expect(store.getState().loading).toBe(true);
    await store.setLanguage("en");
    resolve(HI);
    await pending;
    expect(store.getState().lang).toBe("en");
    expect(root.lang).toBe("en");
  });

  it("works when storage throws", async () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const { store, root } = setup({ storage: throwing });
    void store.init();
    await store.setLanguage("hi");
    expect(root.lang).toBe("hi");
  });
});
