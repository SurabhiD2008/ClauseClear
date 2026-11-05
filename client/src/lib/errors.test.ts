import { ERROR_CODES, type ErrorCode } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import hi from "../i18n/hi.json";
import { interpolate, lookup } from "../i18n/messages";
import { ERROR_NEXT_STEPS, errorMessage } from "./errors";

const DEVANAGARI = /[ऀ-ॿ]/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// F19: every error code has its own message and next step, in both languages.
describe("error copy", () => {
  for (const code of ERROR_CODES as readonly ErrorCode[]) {
    it(`${code}: an English and a Hindi message with the same placeholders, and a next step`, () => {
      const { key, vars } = errorMessage({ code, message: "" });
      const english = lookup(en, key);
      const hindi = lookup(hi, key);
      expect(english).not.toBe(key);
      expect(hindi).not.toBe(key);
      expect(DEVANAGARI.test(english)).toBe(false);
      expect(DEVANAGARI.test(hindi)).toBe(true);
      expect(placeholders(hindi)).toEqual(placeholders(english));
      // Every placeholder is filled, so no "{n}" reaches the screen.
      expect(interpolate(english, vars)).not.toMatch(/\{\w+\}/);
      expect(interpolate(hindi, vars)).not.toMatch(/\{\w+\}/);
      // The message itself says what to do next: a sentence after the first.
      expect(english.split(/(?<=[.?!])\s+/).length).toBeGreaterThanOrEqual(2);
      expect(ERROR_NEXT_STEPS[code]).toBeDefined();
    });
  }

  it("the server's retry-after seconds reach the RATE_LIMITED message", () => {
    const { key, vars } = errorMessage({ code: "RATE_LIMITED", message: "", retryAfterSec: 42 });
    expect(interpolate(lookup(en, key), vars)).toContain("42 seconds");
  });
});
