// SPEC section 8, "General reading (all other documents)". SPEC lists the
// topics without a table, so the flag-when text and default severities here are
// ClauseClear's choice (ASSUMPTIONS A72).
import type { Checklist } from "@clauseclear/shared";

export const generalChecklist: Checklist = {
  docType: "other",
  label: "Legal document",
  categories: [
    {
      id: "one-sided-termination",
      name: "One-sided termination",
      flagWhen:
        "One party can end the agreement much more easily or on shorter notice than the other",
      severity: "high",
    },
    {
      id: "penalties",
      name: "Penalties or liquidated damages",
      flagWhen: "Fixed penalties or damages that look large against the loss they cover",
      severity: "high",
    },
    {
      id: "auto-renewal",
      name: "Automatic renewal",
      flagWhen: "Renews automatically, with a long or hard cancellation window",
      severity: "medium",
    },
    {
      id: "unilateral-amendment",
      name: "Unilateral amendment",
      flagWhen: "One party can change the terms without the other's consent",
      severity: "medium",
    },
    {
      id: "liability-indemnity",
      name: "Limitation of liability and indemnity",
      flagWhen: "One party excludes nearly all liability, or the other must cover its losses",
      severity: "high",
    },
    {
      id: "confidentiality-non-compete",
      name: "Confidentiality and non-compete",
      flagWhen: "Restrictions that last a long time or have a broad scope",
      severity: "medium",
    },
    {
      id: "payment-late-charges",
      name: "Payment terms and late charges",
      flagWhen: "Short payment windows, or late charges that are high, daily or compounding",
      severity: "medium",
    },
    {
      id: "dispute-resolution",
      name: "Dispute resolution",
      flagWhen: "Forum or arbitrator chosen by one side, or a distant venue",
      severity: "medium",
    },
    {
      id: "assignment",
      name: "Assignment",
      flagWhen: "One party can hand the agreement to someone else and the other cannot",
      severity: "medium",
    },
    {
      id: "missing-basics",
      name: "Missing basics",
      flagWhen: "No term or duration, way to end the agreement, or contact for notices (missing)",
      severity: "medium",
    },
  ],
  missingBasics: [
    {
      id: "term-duration",
      name: "Term or duration",
      severity: "medium",
      categoryId: "missing-basics",
    },
    {
      id: "how-to-end",
      name: "How to end the agreement",
      severity: "medium",
      categoryId: "missing-basics",
    },
    {
      id: "notice-contact",
      name: "Contact for notices",
      severity: "medium",
      categoryId: "missing-basics",
    },
  ],
};
