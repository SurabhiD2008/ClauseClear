import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize.js";

describe("normalizeText", () => {
  it("applies NFKC so ligatures and compatibility forms become plain letters", () => {
    expect(normalizeText("The \uFB01nal \uFB02oor, e\uFB03cient sta\uFB00")).toBe(
      "The final floor, efficient staff",
    );
    // Full-width digits and a no-break space.
    expect(normalizeText("Rs.\u00A0\uFF15,\uFF10\uFF10\uFF10")).toBe("Rs. 5,000");
  });

  it("removes control and invisible characters but keeps line breaks", () => {
    const input = "De\u00ADposit\u200B is\u0007 due\uFEFF\u202Enow\nnext line";
    expect(normalizeText(input)).toBe("Deposit is duenow\nnext line");
  });

  it("turns Windows and old Mac line endings into \\n and tabs into spaces", () => {
    expect(normalizeText("one\r\ntwo\rthree\tfour")).toBe("one\ntwo\nthree four");
  });

  it("unifies curly and angled quote marks", () => {
    expect(normalizeText("\u201CTenant\u201D isn\u2019t \u2018Owner\u2019 \u00ABx\u00BB `y`")).toBe(
      "\"Tenant\" isn't 'Owner' \"x\" 'y'",
    );
  });

  it("rejoins words hyphenated across a line break", () => {
    expect(normalizeText("The Tenant shall indem-\nnify the Owner")).toBe(
      "The Tenant shall indemnify the Owner",
    );
    expect(normalizeText("the perfor-  \n  mance of the works")).toBe(
      "the performance of the works",
    );
  });

  it("keeps the hyphen before a capital or a digit, and after self, non and quasi", () => {
    expect(normalizeText("the Pre-\nConstruction Phase")).toBe("the Pre-\nConstruction Phase");
    expect(normalizeText("clause 4-\n2 applies")).toBe("clause 4-\n2 applies");
    expect(normalizeText("any self-\nemployed person")).toBe("any self-employed person");
    expect(normalizeText("a non-\nrefundable fee")).toBe("a non-refundable fee");
  });

  it("leaves hyphens inside a line alone", () => {
    expect(normalizeText("a lock-in period of six months")).toBe("a lock-in period of six months");
  });

  it("collapses spaces, trims lines and keeps at most one blank line between paragraphs", () => {
    expect(normalizeText("  First   line  \n   second line\n\n\n\n\nNew   paragraph  ")).toBe(
      "First line\nsecond line\n\nNew paragraph",
    );
  });

  it("is deterministic and idempotent", () => {
    const input = "\uFB01rst \u201Cterm\u201D  ends-\nwith\r\n\r\n\r\nmore";
    const once = normalizeText(input);
    expect(normalizeText(input)).toBe(once);
    expect(normalizeText(once)).toBe(once);
  });
});
