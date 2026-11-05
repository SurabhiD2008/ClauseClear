import { describe, expect, it } from "vitest";
import { validResult } from "./fixtures/validResult.js";
import { analysisResultSchema } from "./schemas.js";
import { applyTranslations, extractTranslatable } from "./translatable.js";

const EXPECTED_KEYS = [
  "docTypeLabel",
  "summary",
  "keyFacts.k1.label",
  "keyFacts.k1.value",
  "keyFacts.k2.label",
  "keyFacts.k2.value",
  "keyFacts.k3.label",
  "keyFacts.k3.value",
  "keyFacts.k4.label",
  "keyFacts.k4.value",
  "flags.f1.category",
  "flags.f1.title",
  "flags.f1.plain",
  "flags.f1.why",
  "flags.f2.category",
  "flags.f2.title",
  "flags.f2.plain",
  "flags.f2.why",
  "flags.f3.category",
  "flags.f3.title",
  "flags.f3.plain",
  "flags.f3.why",
  "clauses.c1.heading",
  "clauses.c1.plain",
  "clauses.c2.heading",
  "clauses.c2.plain",
  "clauses.c3.heading",
  "clauses.c3.plain",
  "clauses.c4.heading",
  "clauses.c4.plain",
  "clauses.c5.heading",
  "clauses.c5.plain",
  "questions.q1.text",
  "questions.q2.text",
  "questions.q3.text",
  "checklist.before.b1.text",
  "checklist.before.b2.text",
  "checklist.after.a1.text",
  "glossary.g1.definition",
];

describe("extractTranslatable", () => {
  it("returns exactly the tool-written strings, keyed by path", () => {
    expect(Object.keys(extractTranslatable(validResult()))).toEqual(EXPECTED_KEYS);
  });

  it("maps each key to the current English text", () => {
    const map = extractTranslatable(validResult());
    expect(map.summary).toBe(validResult().summary);
    expect(map["flags.f1.title"]).toBe("You lose the whole deposit if you leave early");
    expect(map["checklist.after.a1.text"]).toBe("Keep a record of every visit.");
  });

  it("never includes quotes, segments, the title or glossary terms", () => {
    const r = validResult();
    const map = extractTranslatable(r);
    const keys = Object.keys(map);
    expect(keys.some((k) => k.startsWith("segments") || k.endsWith(".quote"))).toBe(false);
    expect(keys).not.toContain("title");
    expect(keys.some((k) => k.endsWith(".term"))).toBe(false);
    const values = Object.values(map);
    for (const flag of r.flags) {
      if (flag.quote !== undefined) expect(values).not.toContain(flag.quote);
    }
    for (const segment of r.segments) expect(values).not.toContain(segment.text);
  });
});

describe("applyTranslations", () => {
  it("round-trips: applying the extracted map returns an equal result", () => {
    const r = validResult();
    expect(applyTranslations(r, extractTranslatable(r))).toEqual(r);
  });

  it("replaces every translatable string and nothing else", () => {
    const r = validResult();
    const map = extractTranslatable(r);
    const marked = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, `HI:${v}`]));
    const translated = applyTranslations(r, marked);

    expect(extractTranslatable(translated)).toEqual(marked);
    expect(translated.segments).toEqual(r.segments);
    expect(translated.flags.map((f) => f.quote)).toEqual(r.flags.map((f) => f.quote));
    expect(translated.title).toBe(r.title);
    expect(translated.glossary.map((g) => g.term)).toEqual(r.glossary.map((g) => g.term));
    expect(translated.score).toEqual(r.score);
    expect(analysisResultSchema.safeParse(translated).success).toBe(true);
  });

  it("does not mutate its input", () => {
    const r = validResult();
    applyTranslations(r, { summary: "changed", "flags.f1.title": "changed" });
    expect(r).toEqual(validResult());
  });

  it("leaves keys missing from the map in English and ignores unknown keys", () => {
    const r = validResult();
    const translated = applyTranslations(r, {
      summary: "HI",
      "flags.f99.title": "ghost",
      quote: "x",
    });
    expect(translated.summary).toBe("HI");
    expect(translated.flags).toEqual(r.flags);
    expect(Object.keys(translated)).toEqual(Object.keys(r));
  });
});
