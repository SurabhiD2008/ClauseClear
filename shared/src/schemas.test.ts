import { describe, expect, it } from "vitest";
import {
  EXPLANATION_MAX_CHARS,
  MAX_GLOSSARY_TERMS,
  MAX_KEY_FACTS,
  TITLE_MAX_CHARS,
} from "./constants.js";
import { validResult } from "./fixtures/validResult.js";
import {
  analysisResultSchema,
  analyzeTextRequestSchema,
  errorEventSchema,
  sampleResponseSchema,
  statusEventSchema,
  translateRequestSchema,
  translateResponseSchema,
  type AnalysisResult,
} from "./schemas.js";

type Loose = AnalysisResult & Record<string, unknown>;

/** Mutates a fresh valid fixture and asserts it is rejected for the expected reason. */
function expectRejected(mutate: (r: Loose) => void, reason: string) {
  const result = validResult() as Loose;
  mutate(result);
  const parsed = analysisResultSchema.safeParse(result);
  expect(parsed.success).toBe(false);
  const issues = parsed.error?.issues ?? [];
  const matched = issues.some((i) => i.message.includes(reason) || i.code === reason);
  expect(matched, JSON.stringify(issues.map((i) => [i.code, i.message]))).toBe(true);
}

function at<T>(list: T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`fixture has no item ${String(index)}`);
  return item;
}

describe("analysisResultSchema", () => {
  it("accepts the valid fixture", () => {
    const parsed = analysisResultSchema.safeParse(validResult());
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty result with no flags (score 0, band low)", () => {
    const r = validResult();
    r.flags = [];
    r.glossary = [];
    for (const clause of r.clauses) delete clause.flagId;
    r.questions = [];
    r.checklist = { before: [], after: [] };
    r.score = { value: 0, band: "low", counts: { high: 0, medium: 0, missing: 0 } };
    const parsed = analysisResultSchema.safeParse(r);
    expect(parsed.error?.issues).toBeUndefined();
  });

  describe("rejects", () => {
    it("1. duplicate flag ids", () => {
      expectRejected((r) => {
        at(r.flags, 1).id = "f1";
      }, 'duplicate id "f1"');
    });

    it("2. the same id used in two collections", () => {
      expectRejected((r) => {
        at(r.clauses, 0).id = "f1";
      }, 'duplicate id "f1"');
    });

    it("3. a present flag without a quote", () => {
      expectRejected((r) => {
        delete at(r.flags, 0).quote;
      }, "present flag f1 needs segmentId and quote");
    });

    it("4. a present flag without a segmentId", () => {
      expectRejected((r) => {
        delete at(r.flags, 0).segmentId;
      }, "present flag f1 needs segmentId and quote");
    });

    it("5. a missing flag that carries a quote", () => {
      expectRejected((r) => {
        at(r.flags, 2).quote = "anything";
      }, "missing flag f3 must not have segmentId or quote");
    });

    it("6. a flag pointing at an unknown segment", () => {
      expectRejected((r) => {
        at(r.flags, 0).segmentId = "s99";
      }, 'unknown segmentId "s99"');
    });

    it("7. a quote that is not in its segment", () => {
      expectRejected((r) => {
        at(r.flags, 0).quote = "the deposit shall be refunded in full";
      }, "quote of f1 not found in segment s4");
    });

    it("8. a question linked to an unknown flag", () => {
      expectRejected((r) => {
        at(r.questions, 0).flagIds = ["f99"];
      }, 'unknown flagId "f99"');
    });

    it("9. a checklist item linked to an unknown flag", () => {
      expectRejected((r) => {
        at(r.checklist.after, 0).flagIds = ["f42"];
      }, 'unknown flagId "f42"');
    });

    it("10. a flag linked to an unknown glossary term", () => {
      expectRejected((r) => {
        at(r.flags, 0).termIds = ["g9"];
      }, 'unknown termId "g9"');
    });

    it("11. a clause pointing at an unknown segment", () => {
      expectRejected((r) => {
        at(r.clauses, 0).segmentId = "s0";
      }, 'unknown segmentId "s0"');
    });

    it("12. a clause linked to an unknown flag", () => {
      expectRejected((r) => {
        at(r.clauses, 0).flagId = "f7";
      }, 'unknown flagId "f7"');
    });

    it("13. a key fact pointing at an unknown segment", () => {
      expectRejected((r) => {
        at(r.keyFacts, 0).segmentId = "s6";
      }, 'unknown segmentId "s6"');
    });

    it("14. counts that do not match the flags", () => {
      expectRejected((r) => {
        r.score.counts.high = 2;
      }, "score does not match the flags");
    });

    it("15. a score value that does not match the formula", () => {
      expectRejected((r) => {
        r.score.value = 40;
      }, "score does not match the flags");
    });

    it("16. a band that does not match the value", () => {
      expectRejected((r) => {
        r.score.band = "high";
      }, "score does not match the flags");
    });

    it("17. stats.segments that differs from the segment list", () => {
      expectRejected((r) => {
        r.stats.segments = 4;
      }, "stats.segments must equal the number of segments");
    });

    it(`18. a flag title over ${String(TITLE_MAX_CHARS)} characters`, () => {
      expectRejected((r) => {
        at(r.flags, 0).title = "x".repeat(TITLE_MAX_CHARS + 1);
      }, "too_big");
    });

    it(`19. an explanation over ${String(EXPLANATION_MAX_CHARS)} characters`, () => {
      expectRejected((r) => {
        at(r.flags, 0).plain = "x".repeat(EXPLANATION_MAX_CHARS + 1);
      }, "too_big");
    });

    it(`20. more than ${String(MAX_GLOSSARY_TERMS)} glossary terms`, () => {
      expectRejected((r) => {
        r.glossary = Array.from({ length: MAX_GLOSSARY_TERMS + 1 }, (_, i) => ({
          id: `g${String(i + 1)}`,
          term: `term ${String(i)}`,
          definition: "A definition.",
        }));
      }, "too_big");
    });

    it(`21. more than ${String(MAX_KEY_FACTS)} key facts`, () => {
      expectRejected((r) => {
        r.keyFacts = Array.from({ length: MAX_KEY_FACTS + 1 }, (_, i) => ({
          id: `k${String(i + 1)}`,
          label: "Label",
          value: "Value",
        }));
      }, "too_big");
    });

    it("22. an unknown extra field", () => {
      expectRejected((r) => {
        r.riskScoreFromModel = 99;
      }, "unrecognized_keys");
    });

    it("23. a version other than 1", () => {
      expectRejected((r) => {
        r.version = 2 as unknown as 1;
      }, "invalid_value");
    });

    it("24. an unknown document type", () => {
      expectRejected((r) => {
        r.docType = "insurance" as unknown as "other";
      }, "invalid_value");
    });

    it("25. a flag id that is not f<number>", () => {
      expectRejected((r) => {
        at(r.flags, 0).id = "flag-1";
      }, "invalid_format");
    });

    it("26. an empty summary", () => {
      expectRejected((r) => {
        r.summary = "";
      }, "too_small");
    });

    it("27. a repeated warning", () => {
      expectRejected((r) => {
        r.warnings = ["partial_verification", "partial_verification"];
      }, 'duplicate warning "partial_verification"');
    });
  });
});

describe("event and endpoint schemas", () => {
  it("status event accepts every pipeline step and rejects an unknown one", () => {
    for (const step of [
      "reading",
      "segmenting",
      "detecting",
      "analyzing",
      "verifying",
      "scoring",
    ]) {
      expect(statusEventSchema.safeParse({ step }).success).toBe(true);
    }
    expect(statusEventSchema.safeParse({ step: "thinking" }).success).toBe(false);
  });

  it("error event requires a known code and a non-negative retryAfterSec", () => {
    expect(
      errorEventSchema.safeParse({ code: "RATE_LIMITED", message: "Busy", retryAfterSec: 30 })
        .success,
    ).toBe(true);
    expect(errorEventSchema.safeParse({ code: "OOPS", message: "x" }).success).toBe(false);
    expect(
      errorEventSchema.safeParse({ code: "RATE_LIMITED", message: "x", retryAfterSec: -1 }).success,
    ).toBe(false);
  });

  it("analyze text request accepts an optional docType and rejects extra fields", () => {
    expect(analyzeTextRequestSchema.safeParse({ text: "abc" }).success).toBe(true);
    expect(analyzeTextRequestSchema.safeParse({ text: "abc", docType: "loan" }).success).toBe(true);
    expect(analyzeTextRequestSchema.safeParse({ text: "abc", docType: "nda" }).success).toBe(false);
    expect(analyzeTextRequestSchema.safeParse({ text: "abc", admin: true }).success).toBe(false);
  });

  it("translate request only allows lang hi; response lists unchanged keys", () => {
    expect(
      translateRequestSchema.safeParse({ lang: "hi", strings: { summary: "Hello" } }).success,
    ).toBe(true);
    expect(translateRequestSchema.safeParse({ lang: "fr", strings: {} }).success).toBe(false);
    expect(
      translateResponseSchema.safeParse({ strings: { summary: "x" }, unchanged: ["summary"] })
        .success,
    ).toBe(true);
  });

  it("sample response pairs an English result with a Hindi translation map", () => {
    expect(
      sampleResponseSchema.safeParse({ en: validResult(), hi: { summary: "x" } }).success,
    ).toBe(true);
  });
});
