// SPEC section 8, "Rental or leave-and-license". Names and defaults are the
// SPEC table; ids are stable keys for prompts and merges.
import type { Checklist } from "@clauseclear/shared";

export const rentalChecklist: Checklist = {
  docType: "rental",
  label: "Rental agreement",
  categories: [
    {
      id: "lock-in",
      name: "Lock-in and early exit",
      flagWhen: "A penalty exceeds the remaining rent or forfeits the whole deposit",
      severity: "high",
    },
    {
      id: "deposit-return",
      name: "Deposit return",
      flagWhen:
        "No return deadline, open-ended deductions, or the deposit is unusually large against the rent",
      severity: "high",
    },
    {
      id: "owner-termination",
      name: "Termination by owner",
      flagWhen: "Owner can end the agreement on much shorter notice than the tenant",
      severity: "high",
    },
    {
      id: "notice-balance",
      name: "Notice balance",
      flagWhen: "Tenant and owner notice periods differ",
      severity: "medium",
    },
    {
      id: "rent-increase",
      name: "Rent increase",
      flagWhen: "Automatic increase with no cap or formula",
      severity: "medium",
    },
    {
      id: "late-fees",
      name: "Late fees",
      flagWhen: "Daily or compounding fee with no cap or grace period",
      severity: "medium",
    },
    {
      id: "owner-entry",
      name: "Owner entry",
      flagWhen: "Entry at any time with no notice",
      severity: "medium",
    },
    {
      id: "repairs",
      name: "Repairs and maintenance",
      flagWhen: "Tenant bears major repairs or all charges without limits",
      severity: "medium",
    },
    {
      id: "subletting-guests",
      name: "Subletting and guests",
      flagWhen: "Blanket bans or penalties on visitors",
      severity: "medium",
    },
    {
      id: "stamp-duty",
      name: "Stamp duty and registration",
      flagWhen: "Not mentioned (missing)",
      severity: "medium",
    },
    {
      id: "renewal",
      name: "Renewal",
      flagWhen: "Renewal terms unclear or unilateral",
      severity: "medium",
    },
    {
      id: "utilities",
      name: "Utilities and society charges",
      flagWhen: "Who pays what is not stated",
      severity: "medium",
    },
  ],
  missingBasics: [
    {
      id: "stamp-duty-registration",
      name: "Stamp duty and registration",
      severity: "medium",
      categoryId: "stamp-duty",
    },
  ],
};
