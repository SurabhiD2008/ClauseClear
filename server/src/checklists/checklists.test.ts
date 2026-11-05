import { checklistSchema, DOC_TYPES, type Checklist } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { employmentChecklist } from "./employment.js";
import { generalChecklist } from "./general.js";
import { CHECKLISTS, checklistFor } from "./index.js";
import { loanChecklist } from "./loan.js";
import { rentalChecklist } from "./rental.js";
import { termsChecklist } from "./terms.js";

/** The category names and default severities exactly as the SPEC section 8 tables give them. */
const SPEC_TABLES: [Checklist, [string, "high" | "medium"][], string[]][] = [
  [
    rentalChecklist,
    [
      ["Lock-in and early exit", "high"],
      ["Deposit return", "high"],
      ["Termination by owner", "high"],
      ["Notice balance", "medium"],
      ["Rent increase", "medium"],
      ["Late fees", "medium"],
      ["Owner entry", "medium"],
      ["Repairs and maintenance", "medium"],
      ["Subletting and guests", "medium"],
      ["Stamp duty and registration", "medium"],
      ["Renewal", "medium"],
      ["Utilities and society charges", "medium"],
    ],
    ["Stamp duty and registration"],
  ],
  [
    employmentChecklist,
    [
      ["Non-compete and non-solicit", "high"],
      ["Bond and training cost recovery", "high"],
      ["Notice and recovery", "high"],
      ["Variable pay and clawback", "high"],
      ["Probation", "medium"],
      ["IP assignment", "medium"],
      ["Termination", "medium"],
      ["Hours, overtime and leave", "medium"],
      ["Confidentiality", "medium"],
      ["Relocation and transfer", "medium"],
      ["Dispute resolution", "medium"],
      ["Missing basics", "medium"],
    ],
    ["Notice period", "Probation length", "Leave policy"],
  ],
  [
    loanChecklist,
    [
      ["Interest rate", "high"],
      ["Prepayment and foreclosure", "high"],
      ["Late payment and default", "high"],
      ["Collateral and guarantor", "high"],
      ["Acceleration", "high"],
      ["Fees", "medium"],
      ["Insurance bundling", "medium"],
      ["Auto-debit and consent", "medium"],
      ["Credit reporting", "medium"],
      ["Dispute resolution", "medium"],
      ["Missing basics", "high"],
    ],
    ["Repayment schedule", "Total cost of the loan", "Key facts page"],
  ],
  [
    termsChecklist,
    [
      ["Data collection and sharing", "high"],
      ["Licence over your content", "high"],
      ["Auto-renewal and cancellation", "high"],
      ["Arbitration and class-action waiver", "high"],
      ["Indemnification", "high"],
      ["Unilateral changes", "medium"],
      ["Limitation of liability", "medium"],
      ["Account termination", "medium"],
      ["Governing law and forum", "medium"],
      ["Refunds", "medium"],
      ["Missing basics", "medium"],
    ],
    ["Data deletion route", "Complaint contact"],
  ],
];

describe.each(Object.values(CHECKLISTS).map((list) => [list.docType, list] as const))(
  "%s checklist",
  (_docType, list) => {
    it("validates against the shared checklist schema", () => {
      const result = checklistSchema.safeParse(list);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });

    it("has unique category ids, unique names and unique missing-basic ids", () => {
      const ids = list.categories.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(list.categories.map((c) => c.name)).size).toBe(ids.length);
      const basics = list.missingBasics.map((b) => b.id);
      expect(new Set([...basics, ...ids]).size).toBe(basics.length + ids.length);
    });

    it("files every missing basic under one of its categories", () => {
      for (const basic of list.missingBasics) {
        expect(ids(list)).toContain(basic.categoryId);
      }
    });
  },
);

function ids(list: Checklist): string[] {
  return list.categories.map((c) => c.id);
}

describe("SPEC section 8 tables", () => {
  it.each(SPEC_TABLES.map(([list, rows, basics]) => [list.docType, list, rows, basics] as const))(
    "%s has every category with its SPEC default severity, in order",
    (_docType, list, rows, basics) => {
      expect(list.categories.map((c) => [c.name, c.severity])).toEqual(rows);
      expect(list.missingBasics.map((b) => b.name)).toEqual(basics);
      expect(list.categories.every((c) => c.flagWhen.length > 0)).toBe(true);
    },
  );

  it("the general reading covers the nine SPEC topics plus missing basics", () => {
    expect(generalChecklist.categories.map((c) => c.name)).toEqual([
      "One-sided termination",
      "Penalties or liquidated damages",
      "Automatic renewal",
      "Unilateral amendment",
      "Limitation of liability and indemnity",
      "Confidentiality and non-compete",
      "Payment terms and late charges",
      "Dispute resolution",
      "Assignment",
      "Missing basics",
    ]);
    expect(generalChecklist.missingBasics.map((b) => b.name)).toEqual([
      "Term or duration",
      "How to end the agreement",
      "Contact for notices",
    ]);
  });

  it("has one checklist per document type, and other gets the general reading", () => {
    expect(Object.keys(CHECKLISTS).sort()).toEqual([...DOC_TYPES].sort());
    for (const docType of DOC_TYPES) expect(checklistFor(docType).docType).toBe(docType);
    expect(checklistFor("other")).toBe(generalChecklist);
  });

  it("the shared schema rejects duplicate ids and unknown categories", () => {
    const first = rentalChecklist.categories[0];
    if (first === undefined) throw new Error("empty checklist");
    expect(
      checklistSchema.safeParse({
        ...rentalChecklist,
        categories: [first, { ...first, name: "Other" }],
      }).success,
    ).toBe(false);
    expect(
      checklistSchema.safeParse({
        ...rentalChecklist,
        missingBasics: [{ id: "x", name: "X", severity: "medium", categoryId: "nope" }],
      }).success,
    ).toBe(false);
  });
});
