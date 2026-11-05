import type { DotPaths } from "@clauseclear/shared";
import en from "./en.json";

export type Messages = typeof en;
export type MessageKey = DotPaths<Messages>;
export type MessageVars = Record<string, string | number>;

/** English strings ship in the main bundle; Hindi loads on first toggle (hindiAssets.ts). */
export const EN: Messages = en;

/** Returns the string at a dotted key, or the key itself so a missing string is visible and caught by tests. */
export function lookup(messages: Messages, key: MessageKey): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : key;
}

/** Fills {name} placeholders. Unknown placeholders are left as written. */
export function interpolate(template: string, vars?: MessageVars): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
