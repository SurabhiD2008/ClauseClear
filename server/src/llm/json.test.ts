import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, repairRequest, zodOutput } from "./json.js";
import { BadOutputError } from "./provider.js";

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof BadOutputError ? error.reason : "other";
  }
  return undefined;
}

describe("extractJson", () => {
  it("parses plain JSON, fenced JSON and JSON wrapped in prose", () => {
    expect(extractJson("p", '{"a":1}')).toEqual({ a: 1 });
    expect(extractJson("p", '```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson("p", "```\n[1,2]\n```")).toEqual([1, 2]);
    expect(extractJson("p", 'Here you go:\n{"a":{"b":2}}\nHope that helps.')).toEqual({
      a: { b: 2 },
    });
  });

  it("rejects malformed and truncated JSON as malformed", () => {
    expect(reasonOf(() => extractJson("p", "{ this is not JSON"))).toBe("malformed");
    expect(reasonOf(() => extractJson("p", '{"flags":[{"id":"f1","quote":"The lic'))).toBe(
      "malformed",
    );
    expect(reasonOf(() => extractJson("p", "no json here"))).toBe("malformed");
    expect(reasonOf(() => extractJson("p", ""))).toBe("malformed");
  });
});

describe("zodOutput", () => {
  const output = zodOutput(z.strictObject({ title: z.string().max(5), count: z.int() }));

  it("returns the validated value", () => {
    expect(output.parse("p", '{"title":"Lease","count":2}')).toEqual({ title: "Lease", count: 2 });
  });

  it("allows exactly one repair retry (SCHEMA_REPAIR_RETRIES)", () => {
    expect(output.repairRetries).toBe(1);
  });

  it("a schema failure carries a repair hint with paths and rules but never the values", () => {
    let error: unknown;
    try {
      output.parse("p", '{"title":"SECRET-DOCUMENT-WORDS","count":"three","extra":true}');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BadOutputError);
    const hint = (error as BadOutputError).repairHint ?? "";
    expect(hint).toContain("- title:");
    expect(hint).toContain("- count:");
    expect(hint).not.toContain("SECRET-DOCUMENT-WORDS");
    expect(hint).not.toContain("three");
    expect((error as BadOutputError).message).not.toContain("SECRET");
  });

  it("malformed JSON has no repair hint, so the router moves on instead", () => {
    try {
      output.parse("p", "{ nope");
    } catch (error) {
      expect((error as BadOutputError).repairHint).toBeUndefined();
    }
  });

  it("the repair request keeps the original prompt and appends the issues", () => {
    const repaired = repairRequest(
      { system: "s", user: "u", schemaName: "x", maxOutputTokens: 10 },
      "- title: Too big",
    );
    expect(repaired.system).toBe("s");
    expect(repaired.user.startsWith("u\n\n")).toBe(true);
    expect(repaired.user).toContain("- title: Too big");
  });
});
