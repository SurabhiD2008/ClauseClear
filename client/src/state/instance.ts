// The browser's one set of stores. Tests build their own with createAppStores.
import { createApi } from "../lib/api";
import { createAppStores, type AppStores } from "./app";
import { languageStore } from "./language";
import type { TickStorage } from "./ui";

function browserSessionStorage(): TickStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export const app: AppStores = createAppStores({
  api: createApi(),
  language: languageStore,
  tickStorage: typeof window === "undefined" ? null : browserSessionStorage(),
});
