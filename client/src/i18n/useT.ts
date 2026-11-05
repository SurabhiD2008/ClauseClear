import { useCallback, useSyncExternalStore } from "react";
import { languageStore, type LanguageState } from "../state/language";
import { interpolate, lookup, type MessageKey, type MessageVars } from "./messages";

export function useLanguage(): LanguageState {
  return useSyncExternalStore(languageStore.subscribe, languageStore.getState);
}

/** t("header.navHow"), or t("checklist.done", { done: 3, total: 14 }) for templates. */
export function useT(): (key: MessageKey, vars?: MessageVars) => string {
  const { messages } = useLanguage();
  return useCallback((key, vars) => interpolate(lookup(messages, key), vars), [messages]);
}
