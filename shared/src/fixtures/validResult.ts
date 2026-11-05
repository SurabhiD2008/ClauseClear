import type { AnalysisResult } from "../schemas.js";

// A small, fictional rental result that satisfies every schema rule.
// Score: 1 high (18) + 1 medium (8) + 1 medium missing (5) = 31, band "medium".
export function validResult(): AnalysisResult {
  return {
    version: 1,
    docType: "rental",
    docTypeLabel: "Rental agreement",
    docTypeConfidence: "high",
    title: "Leave and License Agreement",
    stats: { pages: 2, chars: 455, segments: 5 },
    segments: [
      {
        id: "s1",
        page: 1,
        text: "1. TERM. This leave and license agreement runs for 11 months from 1 March 2026.",
      },
      {
        id: "s2",
        page: 1,
        text: "2. LICENSE FEE. The licensee shall pay Rs. 25,000 per month on or before the 5th day of each month.",
      },
      {
        id: "s3",
        page: 1,
        text: "3. DEPOSIT. The licensee shall pay a security deposit of Rs. 1,50,000.",
      },
      {
        id: "s4",
        page: 2,
        text: "4. LOCK-IN. If the licensee leaves within the lock-in period of 6 months, the entire security deposit shall be forfeited.",
      },
      { id: "s5", page: 2, text: "5. ENTRY. The licensor may enter the premises at any time." },
    ],
    summary:
      "This is an 11-month leave and license agreement for Rs. 25,000 a month. Leaving in the first 6 months may cost you the whole deposit.",
    score: { value: 31, band: "medium", counts: { high: 1, medium: 1, missing: 1 } },
    keyFacts: [
      { id: "k1", label: "Rent", value: "Rs. 25,000 per month", segmentId: "s2" },
      { id: "k2", label: "Deposit", value: "Rs. 1,50,000", segmentId: "s3" },
      { id: "k3", label: "Term", value: "11 months", segmentId: "s1" },
      { id: "k4", label: "Lock-in", value: "6 months" },
    ],
    flags: [
      {
        id: "f1",
        kind: "present",
        severity: "high",
        category: "Lock-in and early exit",
        title: "You lose the whole deposit if you leave early",
        plain: "Leaving in the first 6 months means the owner keeps all of your deposit.",
        why: "That is far more than the rent you would still owe.",
        segmentId: "s4",
        quote: "the entire security deposit shall be forfeited",
        termIds: ["g1"],
      },
      {
        id: "f2",
        kind: "present",
        severity: "medium",
        category: "Owner entry",
        title: "The owner can come in at any time",
        plain: "The owner does not have to warn you before entering.",
        why: "It may be worth asking for notice before visits.",
        segmentId: "s5",
        quote: "The licensor may enter the premises at any time.",
        termIds: [],
      },
      {
        id: "f3",
        kind: "missing",
        severity: "medium",
        category: "Stamp duty and registration",
        title: "Registration is not mentioned",
        plain: "The agreement does not say who registers it or pays stamp duty.",
        why: "An unregistered agreement may be harder to rely on.",
        termIds: [],
      },
    ],
    clauses: [
      { id: "c1", segmentId: "s1", heading: "Term", plain: "The agreement lasts 11 months." },
      { id: "c2", segmentId: "s2", heading: "Rent", plain: "You pay Rs. 25,000 by the 5th." },
      { id: "c3", segmentId: "s3", heading: "Deposit", plain: "You pay a Rs. 1,50,000 deposit." },
      {
        id: "c4",
        segmentId: "s4",
        heading: "Lock-in",
        plain: "Leave early and you lose the deposit.",
        flagId: "f1",
      },
      {
        id: "c5",
        segmentId: "s5",
        heading: "Entry",
        plain: "The owner can enter at any time.",
        flagId: "f2",
      },
    ],
    questions: [
      { id: "q1", text: "Can the lock-in penalty be one month's rent instead?", flagIds: ["f1"] },
      { id: "q2", text: "Can you give 24 hours' notice before visiting?", flagIds: ["f2"] },
      { id: "q3", text: "Who will register this agreement?", flagIds: ["f3"] },
    ],
    checklist: {
      before: [
        { id: "b1", text: "Ask to reduce the lock-in penalty.", flagIds: ["f1"] },
        { id: "b2", text: "Agree who pays for registration.", flagIds: ["f3"] },
      ],
      after: [{ id: "a1", text: "Keep a record of every visit.", flagIds: ["f2"] }],
    },
    glossary: [
      {
        id: "g1",
        term: "lock-in period",
        definition: "A time during which leaving early costs you a penalty.",
      },
    ],
    warnings: [],
  };
}
