// The mock model's glossary: a few legal terms with plain definitions, returned
// for the terms that appear in the text it was given.
const GLOSSARY: [string, string][] = [
  ["lock-in period", "A time at the start when you cannot leave without paying a penalty."],
  ["security deposit", "Money you pay at the start that should come back to you at the end."],
  ["licensee", "The person who is allowed to use the place, usually you."],
  ["licensor", "The owner who lets you use the place."],
  ["indemnify", "To pay for someone else's losses or legal costs."],
  ["arbitration", "Settling a dispute through a private judge instead of a court."],
  ["liquidated damages", "A fixed amount you agree to pay if you break the agreement."],
  ["probation", "A trial period at the start of a job."],
  ["foreclosure", "Paying off a loan in full before its end date."],
  ["guarantor", "A person who promises to pay if the borrower does not."],
  ["notice period", "How much warning one side must give before ending the agreement."],
  ["class action", "A case brought by many people together against one company."],
];

export function glossaryOf(text: string) {
  const lower = text.toLowerCase();
  return GLOSSARY.filter(([term]) => lower.includes(term)).map(([term, definition]) => ({
    term,
    definition,
  }));
}
