// SPEC section 8, "Terms of service or user agreement".
import type { Checklist } from "@clauseclear/shared";

export const termsChecklist: Checklist = {
  docType: "terms",
  label: "Terms of service",
  categories: [
    {
      id: "data-sharing",
      name: "Data collection and sharing",
      flagWhen: "Broad collection or sharing with unnamed third parties",
      severity: "high",
    },
    {
      id: "content-licence",
      name: "Licence over your content",
      flagWhen: "Perpetual, transferable or commercial rights over what you post",
      severity: "high",
    },
    {
      id: "auto-renewal",
      name: "Auto-renewal and cancellation",
      flagWhen: "Renews automatically, with hard-to-use cancellation",
      severity: "high",
    },
    {
      id: "arbitration",
      name: "Arbitration and class-action waiver",
      flagWhen: "You give up the right to go to court",
      severity: "high",
    },
    {
      id: "indemnification",
      name: "Indemnification",
      flagWhen: "You pay the company's losses linked to your use",
      severity: "high",
    },
    {
      id: "unilateral-changes",
      name: "Unilateral changes",
      flagWhen: "Terms can change without notice",
      severity: "medium",
    },
    {
      id: "liability",
      name: "Limitation of liability",
      flagWhen: "Company excludes nearly all liability",
      severity: "medium",
    },
    {
      id: "account-termination",
      name: "Account termination",
      flagWhen: "Company can end access at any time with no refund",
      severity: "medium",
    },
    {
      id: "governing-law",
      name: "Governing law and forum",
      flagWhen: "Distant or one-sided forum",
      severity: "medium",
    },
    {
      id: "refunds",
      name: "Refunds",
      flagWhen: "Refund terms absent or very narrow",
      severity: "medium",
    },
    {
      id: "missing-basics",
      name: "Missing basics",
      flagWhen: "No data deletion route or complaint contact (missing)",
      severity: "medium",
    },
  ],
  missingBasics: [
    {
      id: "data-deletion",
      name: "Data deletion route",
      severity: "medium",
      categoryId: "missing-basics",
    },
    {
      id: "complaint-contact",
      name: "Complaint contact",
      severity: "medium",
      categoryId: "missing-basics",
    },
  ],
};
