// One checklist per document type (SPEC section 8). "other" gets the general reading.
import type { Checklist, DocType } from "@clauseclear/shared";
import { employmentChecklist } from "./employment.js";
import { generalChecklist } from "./general.js";
import { loanChecklist } from "./loan.js";
import { rentalChecklist } from "./rental.js";
import { termsChecklist } from "./terms.js";

export const CHECKLISTS: Record<DocType, Checklist> = {
  rental: rentalChecklist,
  employment: employmentChecklist,
  loan: loanChecklist,
  terms: termsChecklist,
  other: generalChecklist,
};

export function checklistFor(docType: DocType): Checklist {
  return CHECKLISTS[docType];
}
