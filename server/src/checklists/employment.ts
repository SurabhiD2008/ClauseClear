// SPEC section 8, "Employment offer or contract".
import type { Checklist } from "@clauseclear/shared";

export const employmentChecklist: Checklist = {
  docType: "employment",
  label: "Employment offer or contract",
  categories: [
    {
      id: "non-compete",
      name: "Non-compete and non-solicit",
      flagWhen: "Restriction continues after leaving, with a long period or broad scope",
      severity: "high",
    },
    {
      id: "bond",
      name: "Bond and training cost recovery",
      flagWhen: "Employee must repay money if they leave early",
      severity: "high",
    },
    {
      id: "notice-recovery",
      name: "Notice and recovery",
      flagWhen: "Long notice, or pay in lieu with no cap, or deductions from final pay",
      severity: "high",
    },
    {
      id: "variable-pay",
      name: "Variable pay and clawback",
      flagWhen: "Pay that can be reduced or taken back at the employer's discretion",
      severity: "high",
    },
    {
      id: "probation",
      name: "Probation",
      flagWhen: "Length unclear or can be extended freely",
      severity: "medium",
    },
    {
      id: "ip-assignment",
      name: "IP assignment",
      flagWhen: "Claims work done outside the job or off hours",
      severity: "medium",
    },
    {
      id: "termination",
      name: "Termination",
      flagWhen: 'Vague "for cause" definition or termination without notice',
      severity: "medium",
    },
    {
      id: "hours-leave",
      name: "Hours, overtime and leave",
      flagWhen: "Unlimited hours, no overtime or leave terms",
      severity: "medium",
    },
    {
      id: "confidentiality",
      name: "Confidentiality",
      flagWhen: "Unlimited duration or unclear scope",
      severity: "medium",
    },
    {
      id: "relocation",
      name: "Relocation and transfer",
      flagWhen: "Employer can move the employee with no notice or support",
      severity: "medium",
    },
    {
      id: "dispute-resolution",
      name: "Dispute resolution",
      flagWhen: "Distant jurisdiction or employer-chosen arbitrator",
      severity: "medium",
    },
    {
      id: "missing-basics",
      name: "Missing basics",
      flagWhen: "No notice period, probation length or leave policy stated (missing)",
      severity: "medium",
    },
  ],
  missingBasics: [
    {
      id: "notice-period",
      name: "Notice period",
      severity: "medium",
      categoryId: "missing-basics",
    },
    {
      id: "probation-length",
      name: "Probation length",
      severity: "medium",
      categoryId: "missing-basics",
    },
    { id: "leave-policy", name: "Leave policy", severity: "medium", categoryId: "missing-basics" },
  ],
};
