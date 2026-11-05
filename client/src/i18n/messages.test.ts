import { DEVANAGARI_PATTERN } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import hi from "./hi.json";
import { interpolate, lookup } from "./messages";

interface Tree {
  [key: string]: string | Tree;
}

/** Every leaf as [dotted.key, value], in file order. */
function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [[path, value]] : leaves(value, path);
  });
}

const enLeaves = leaves(en);
const hiLeaves = leaves(hi);
const hiByKey = new Map(hiLeaves);

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

describe("message files", () => {
  it("en.json and hi.json have identical key sets", () => {
    expect(hiLeaves.map(([key]) => key).sort()).toEqual(enLeaves.map(([key]) => key).sort());
  });

  it("en.json contains no Devanagari character", () => {
    const offending = enLeaves.filter(([, value]) => DEVANAGARI_PATTERN.test(value));
    expect(offending).toEqual([]);
  });

  it("no hi.json value is empty", () => {
    const empty = hiLeaves.filter(([, value]) => value.trim() === "");
    expect(empty).toEqual([]);
  });

  it("no en.json value is empty", () => {
    const empty = enLeaves.filter(([, value]) => value.trim() === "");
    expect(empty).toEqual([]);
  });

  it("each Hindi string uses the same {placeholders} as its English string", () => {
    const mismatched = enLeaves
      .filter(([key, value]) => {
        const hindi = hiByKey.get(key);
        return hindi !== undefined && placeholders(hindi).join() !== placeholders(value).join();
      })
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("hi.json is actually Hindi: most values contain Devanagari", () => {
    const withDevanagari = hiLeaves.filter(([, value]) => DEVANAGARI_PATTERN.test(value)).length;
    expect(withDevanagari / hiLeaves.length).toBeGreaterThan(0.8);
  });
});

describe("lookup and interpolate", () => {
  it("finds a nested key", () => {
    expect(lookup(en, "header.navHow")).toBe(en.header.navHow);
  });

  it("returns the key itself when a key is missing", () => {
    expect(
      lookup({ ...en, header: { ...en.header, navHow: undefined } } as never, "header.navHow"),
    ).toBe("header.navHow");
  });

  it("fills named placeholders", () => {
    expect(interpolate("{done} of {total} done", { done: 3, total: 14 })).toBe("3 of 14 done");
  });

  it("leaves unknown placeholders as written", () => {
    expect(interpolate("Flag {n}", {})).toBe("Flag {n}");
  });
});
