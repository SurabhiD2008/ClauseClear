import type { AnalysisResult, ChecklistItem, Flag } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import jobOffer from "../../../fixtures/samples/job-offer.json";
import loan from "../../../fixtures/samples/loan.json";
import rental from "../../../fixtures/samples/rental.json";
import { checklistProgress, checklistText, itemTag } from "./checklist";
import { flagNumbers } from "./document";

const FIXTURES: Record<string, { en: unknown }> = { rental, "job-offer": jobOffer, loan };
const fixture = (id: string) => FIXTURES[id]?.en as AnalysisResult;

/** Every subset of the items, as tick lists: the progress math is checked on all of them. */
function subsets(ids: readonly string[]): string[][] {
  return Array.from({ length: 2 ** ids.length }, (_, mask) =>
    ids.filter((_, i) => (mask >> i) & 1),
  );
}

describe("checklistProgress", () => {
  for (const id of ["rental", "job-offer", "loan"]) {
    it(`${id}: counts, split and percent agree with an independent count for every tick set`, () => {
      const { checklist } = fixture(id);
      const ids = [...checklist.before, ...checklist.after].map((item) => item.id);
      for (const ticks of subsets(ids)) {
        const p = checklistProgress(checklist, ticks);
        let b = 0;
        let a = 0;
        for (const tick of ticks) {
          if (checklist.before.some((item) => item.id === tick)) b += 1;
          if (checklist.after.some((item) => item.id === tick)) a += 1;
        }
        expect(p).toEqual({
          done: b + a,
          total: ids.length,
          b,
          bn: checklist.before.length,
          a,
          an: checklist.after.length,
          percent: ((b + a) / ids.length) * 100,
        });
      }
    });
  }

  it("ignores ticks for items that are not on the list, and an empty list is 0 percent", () => {
    const checklist = { before: [{ id: "b1", text: "x", flagIds: [] }], after: [] };
    expect(checklistProgress(checklist, ["b1", "gone"]).done).toBe(1);
    expect(checklistProgress({ before: [], after: [] }, ["b1"])).toMatchObject({
      done: 0,
      total: 0,
      percent: 0,
    });
  });
});

const flag = (over: Partial<Flag> & Pick<Flag, "id">): Flag => ({
  kind: "present",
  severity: "medium",
  category: "c",
  title: "t",
  plain: "p",
  why: "w",
  termIds: [],
  ...over,
});

describe("itemTag", () => {
  const flags = [
    flag({ id: "f1", severity: "high", segmentId: "s1", quote: "q" }),
    flag({ id: "f2", segmentId: "s2", quote: "q" }),
    flag({ id: "f3", kind: "missing", severity: "medium" }),
  ];
  const numbers = flagNumbers(flags);
  const item = (flagIds: string[]): ChecklistItem => ({ id: "i", text: "x", flagIds });

  it("has no tag for an item no flag raised, or one naming unknown flags", () => {
    expect(itemTag(item([]), flags, numbers)).toBeNull();
    expect(itemTag(item(["f9"]), flags, numbers)).toBeNull();
  });

  it("orders flags by their number and takes the worst tone", () => {
    const tag = itemTag(item(["f2", "f1"]), flags, numbers);
    expect(tag?.flags.map((entry) => entry.n)).toEqual([1, 2]);
    expect(tag?.tone).toBe("high");
    expect(itemTag(item(["f2"]), flags, numbers)?.tone).toBe("medium");
    expect(itemTag(item(["f3"]), flags, numbers)?.tone).toBe("missing");
  });
});

describe("checklistText", () => {
  it("lists both sheets with [x] for ticked items and the tag in brackets", () => {
    const checklist = {
      before: [
        { id: "b1", text: "Ask about the deposit", flagIds: ["f1"] },
        { id: "b2", text: "Check the names", flagIds: [] },
      ],
      after: [{ id: "a1", text: "Keep a copy", flagIds: [] }],
    };
    const text = checklistText(checklist, ["b2"], {
      title: "Before you sign, and after",
      progress: "1 of 3 done",
      before: "Before you sign",
      after: "After you sign",
      tag: (i) => (i.flagIds.length > 0 ? "Flag 1 · Deposit" : null),
    });
    expect(text).toBe(
      [
        "Before you sign, and after",
        "1 of 3 done",
        "",
        "Before you sign",
        "[ ] Ask about the deposit (Flag 1 · Deposit)",
        "[x] Check the names",
        "",
        "After you sign",
        "[ ] Keep a copy",
      ].join("\n"),
    );
  });
});
