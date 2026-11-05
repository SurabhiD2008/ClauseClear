// SPEC section 8, "Loan or credit agreement".
import type { Checklist } from "@clauseclear/shared";

export const loanChecklist: Checklist = {
  docType: "loan",
  label: "Loan or credit agreement",
  categories: [
    {
      id: "interest-rate",
      name: "Interest rate",
      flagWhen: "Rate type or effective annual cost is unclear, or the lender can change the rate",
      severity: "high",
    },
    {
      id: "prepayment",
      name: "Prepayment and foreclosure",
      flagWhen: "Charges for paying early",
      severity: "high",
    },
    {
      id: "late-payment",
      name: "Late payment and default",
      flagWhen: "Penalty interest or fees that stack",
      severity: "high",
    },
    {
      id: "collateral-guarantor",
      name: "Collateral and guarantor",
      flagWhen: "Guarantor or collateral liability is wider than the loan",
      severity: "high",
    },
    {
      id: "acceleration",
      name: "Acceleration",
      flagWhen: "Lender can demand full repayment on broad triggers",
      severity: "high",
    },
    {
      id: "fees",
      name: "Fees",
      flagWhen: "Processing, documentation or hidden charges not itemised",
      severity: "medium",
    },
    {
      id: "insurance",
      name: "Insurance bundling",
      flagWhen: "Insurance or add-ons tied to the loan",
      severity: "medium",
    },
    {
      id: "auto-debit",
      name: "Auto-debit and consent",
      flagWhen: "Standing debit instructions with wide permissions",
      severity: "medium",
    },
    {
      id: "credit-reporting",
      name: "Credit reporting",
      flagWhen: "Data sharing terms are broad",
      severity: "medium",
    },
    {
      id: "dispute-resolution",
      name: "Dispute resolution",
      flagWhen: "Lender-chosen forum or arbitrator",
      severity: "medium",
    },
    {
      id: "missing-basics",
      name: "Missing basics",
      flagWhen: "No repayment schedule, total cost or key facts page (missing)",
      severity: "high",
    },
  ],
  missingBasics: [
    {
      id: "repayment-schedule",
      name: "Repayment schedule",
      severity: "high",
      categoryId: "missing-basics",
    },
    {
      id: "total-cost",
      name: "Total cost of the loan",
      severity: "high",
      categoryId: "missing-basics",
    },
    { id: "key-facts", name: "Key facts page", severity: "high", categoryId: "missing-basics" },
  ],
};
