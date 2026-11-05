import { describe, expect, it } from "vitest";
import { checklistFor } from "../checklists/index.js";
import {
  assembleDraft,
  mergeChunks,
  normalizeFlag,
  type ChunkFindings,
  type SynthesisFindings,
} from "./merge.js";
import type { ModelFlag } from "./modelOutput.js";

const rental = checklistFor("rental");

const flag = (
  id: string,
  segmentId: string,
  categoryId: string,
  extra: Partial<ModelFlag> = {},
): ModelFlag => ({
  id,
  categoryId,
  severity: rental.categories.find((c) => c.id === categoryId)?.severity ?? "medium",
  segmentId,
  quote: `quote from ${segmentId}`,
  title: `title ${id}`,
  plain: "plain",
  why: "why",
  ...extra,
});

const chunk = (part: number, findings: Partial<ChunkFindings>): ChunkFindings => ({
  part,
  coverage: [],
  flags: [],
  clauses: [],
  keyFacts: [],
  ...findings,
});

const noSynthesis: SynthesisFindings = {
  summary: "Two sentences. Of summary.",
  keyFacts: [],
  missing: [],
  questions: [],
  checklist: { before: [], after: [] },
  glossary: [],
};

describe("normalizeFlag", () => {
  it("keeps the category default when the model moves severity without a reason", () => {
    expect(
      normalizeFlag(flag("f1", "s1", "late-fees", { severity: "high" }), rental)?.severity,
    ).toBe("medium");
    expect(
      normalizeFlag(
        flag("f1", "s1", "late-fees", {
          severity: "high",
          severityReason: "The fee compounds daily.",
        }),
        rental,
      )?.severity,
    ).toBe("high");
  });

  it("drops a flag whose category is not on the checklist", () => {
    expect(normalizeFlag(flag("f1", "s1", "made-up"), rental)).toBeUndefined();
  });
});

describe("mergeChunks", () => {
  it("dedupes flags by segment and category, keeping the higher severity and every ref", () => {
    const merged = mergeChunks(
      [
        chunk(0, {
          flags: [
            flag("f1", "s3", "late-fees"),
            flag("f2", "s3", "late-fees", { severity: "high", severityReason: "r" }),
          ],
        }),
        chunk(1, { flags: [flag("f1", "s9", "owner-entry")] }),
      ],
      rental,
    );
    expect(merged.flags).toHaveLength(2);
    expect(merged.flags[0]?.flag.severity).toBe("high");
    expect(merged.flags[0]?.refs).toEqual(["0:f1", "0:f2"]);
    expect(merged.flags[1]?.refs).toEqual(["1:f1"]);
  });

  it("keeps two flags on one segment when their categories differ", () => {
    const merged = mergeChunks(
      [chunk(0, { flags: [flag("f1", "s3", "late-fees"), flag("f2", "s3", "lock-in")] })],
      rental,
    );
    expect(merged.flags.map((m) => m.flag.categoryId)).toEqual(["late-fees", "lock-in"]);
  });

  it("orders flags by segment, whatever order the parts finished in", () => {
    const merged = mergeChunks(
      [
        chunk(1, { flags: [flag("f1", "s20", "renewal")] }),
        chunk(0, { flags: [flag("f1", "s2", "lock-in")] }),
      ],
      rental,
    );
    expect(merged.flags.map((m) => m.flag.segmentId)).toEqual(["s2", "s20"]);
  });

  it("dedupes clause readings by segment and key facts by label and value", () => {
    const merged = mergeChunks(
      [
        chunk(0, {
          clauses: [{ segmentId: "s2", heading: "A", plain: "first" }],
          keyFacts: [{ label: "Rent", value: "Rs. 28,000" }],
        }),
        chunk(1, {
          clauses: [
            { segmentId: "s2", heading: "B", plain: "second" },
            { segmentId: "s1", heading: "C", plain: "c" },
          ],
          keyFacts: [
            { label: "rent ", value: "Rs.  28,000" },
            { label: "Deposit", value: "Rs. 2,80,000" },
          ],
        }),
      ],
      rental,
    );
    expect(merged.clauses.map((c) => [c.segmentId, c.plain])).toEqual([
      ["s1", "c"],
      ["s2", "first"],
    ]);
    expect(merged.keyFacts.map((k) => k.label)).toEqual(["Rent", "Deposit"]);
  });

  it("keeps the strongest coverage report and lists the categories nobody covered", () => {
    const merged = mergeChunks(
      [
        chunk(0, {
          coverage: [
            { categoryId: "renewal", status: "fine" },
            { categoryId: "nonsense", status: "fine" },
          ],
        }),
        chunk(1, {
          coverage: [{ categoryId: "renewal", status: "flagged" }],
          flags: [flag("f1", "s9", "owner-entry")],
        }),
      ],
      rental,
    );
    expect(merged.coverage.renewal).toBe("flagged");
    expect(merged.coverage["owner-entry"]).toBe("flagged");
    expect(merged.coverage).not.toHaveProperty("nonsense");
    expect(merged.uncovered).toEqual(
      rental.categories.map((c) => c.id).filter((id) => id !== "renewal" && id !== "owner-entry"),
    );
  });
});

describe("assembleDraft", () => {
  const base = {
    checklist: rental,
    docType: "rental" as const,
    docTypeLabel: "Rental agreement",
    docTypeConfidence: "high" as const,
    title: "Agreement",
    path: "single" as const,
    calls: 1,
  };

  it("numbers present flags then missing items, and remaps the model's refs", () => {
    const merged = mergeChunks(
      [
        chunk(0, {
          flags: [flag("f2", "s9", "owner-entry"), flag("f1", "s4", "lock-in")],
          clauses: [{ segmentId: "s4", heading: "Lock-in", plain: "p" }],
        }),
      ],
      rental,
    );
    const draft = assembleDraft({
      ...base,
      merged,
      flagRefs: "model",
      synthesis: {
        ...noSynthesis,
        missing: [
          {
            id: "m1",
            basicId: "stamp-duty-registration",
            title: "No stamp duty",
            plain: "p",
            why: "w",
          },
          { id: "m2", basicId: "stamp-duty-registration", title: "Repeat", plain: "p", why: "w" },
          { id: "m3", basicId: "unknown-basic", title: "Unknown", plain: "p", why: "w" },
        ],
        questions: [{ text: "Can the lock-in be shorter?", refs: ["f1", "f9", "m1", "f1"] }],
        checklist: {
          before: [{ text: "Ask about entry", refs: ["f2"] }],
          after: [{ text: "Keep a copy", refs: [] }],
        },
        glossary: [
          { term: "Lock-in", definition: "d" },
          { term: "lock-in", definition: "duplicate" },
        ],
      },
    });
    // s4 sorts before s9, so the model's f1 becomes f1 and its f2 becomes f2.
    expect(draft.flags.map((f) => [f.id, f.kind, f.segmentId ?? null])).toEqual([
      ["f1", "present", "s4"],
      ["f2", "present", "s9"],
      ["f3", "missing", null],
    ]);
    expect(draft.flags[2]).toMatchObject({
      category: "Stamp duty and registration",
      severity: "medium",
    });
    expect(draft.questions[0]?.flagIds).toEqual(["f1", "f3"]);
    expect(draft.checklist.before[0]).toEqual({
      id: "b1",
      text: "Ask about entry",
      flagIds: ["f2"],
    });
    expect(draft.checklist.after[0]?.id).toBe("a1");
    expect(draft.glossary).toEqual([{ id: "g1", term: "Lock-in", definition: "d" }]);
    expect(draft.clauses[0]).toEqual({
      id: "c1",
      segmentId: "s4",
      heading: "Lock-in",
      plain: "p",
      flagId: "f1",
    });
  });

  it("links glossary terms to the flags whose text uses them", () => {
    const merged = mergeChunks(
      [
        chunk(0, {
          flags: [
            flag("f1", "s4", "lock-in", {
              quote: "the entire security deposit shall stand forfeited",
            }),
          ],
        }),
      ],
      rental,
    );
    const draft = assembleDraft({
      ...base,
      merged,
      flagRefs: "model",
      synthesis: {
        ...noSynthesis,
        glossary: [
          { term: "security deposit", definition: "d" },
          { term: "arbitration", definition: "d" },
        ],
      },
    });
    expect(draft.flags[0]?.termIds).toEqual(["g1"]);
  });

  it("drops a missing item whose category was found flagged in the document", () => {
    const merged = mergeChunks([chunk(0, { flags: [flag("f1", "s2", "stamp-duty")] })], rental);
    const draft = assembleDraft({
      ...base,
      merged,
      flagRefs: "model",
      synthesis: {
        ...noSynthesis,
        missing: [
          { id: "m1", basicId: "stamp-duty-registration", title: "t", plain: "p", why: "w" },
        ],
      },
    });
    expect(draft.flags.filter((f) => f.kind === "missing")).toEqual([]);
  });

  it("in the chunked path, refs are the final ids the synthesis call saw", () => {
    const merged = mergeChunks(
      [
        chunk(0, { flags: [flag("f1", "s2", "lock-in")] }),
        chunk(1, { flags: [flag("f1", "s30", "renewal")] }),
      ],
      rental,
    );
    const draft = assembleDraft({
      ...base,
      path: "chunked",
      merged,
      flagRefs: "final",
      synthesis: { ...noSynthesis, questions: [{ text: "About renewal?", refs: ["f2"] }] },
    });
    expect(draft.questions[0]?.flagIds).toEqual(["f2"]);
    expect(draft.flags[1]?.segmentId).toBe("s30");
  });
});
