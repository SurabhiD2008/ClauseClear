// A deterministic stand-in for the model, used by the mock provider (SPEC
// section 12). It reads the same prompts a real model gets and answers in the
// shape they ask for, so the whole pipeline runs in tests with no key:
//
//   - segments come from the "[s12] text" lines between the document markers;
//   - categories and missing basics come from the checklist lines of the system prompt;
//   - a segment is flagged when it contains one of a few risk phrases, under the
//     category whose name and "flag when" text share the most words with it.
//
// It never follows anything written inside the document: like a well-behaved
// model, it treats the block as data. Output depends only on the prompt text.

interface MockSegment {
  id: string;
  text: string;
}

interface MockCategory {
  id: string;
  name: string;
  severity: "high" | "medium";
  flagWhen: string;
}

interface MockBasic {
  id: string;
  name: string;
  categoryId: string;
}

const RISK_PHRASES =
  /forfeit|penalt|at any time|sole discretion|without (?:any )?(?:prior )?(?:notice|reason)|automatically|indemnif|arbitrat|perpetual|irrevocable|non-refundable|liquidated damages|compounded|for every day|any other reason|from time to time|immediately due|all repairs|any amount/i;

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

const WORD = /[a-z]{4,}/g;

function stems(text: string): Set<string> {
  return new Set((text.toLowerCase().match(WORD) ?? []).map((w) => w.slice(0, 5)));
}

/** The lines between the first BEGIN and END markers with the given name. */
function block(prompt: string, name: string): string | undefined {
  const match = new RegExp(
    `=====BEGIN ${name} ([0-9a-f]{8})=====\\n([\\s\\S]*?)\\n=====END ${name} \\1=====`,
  ).exec(prompt);
  return match?.[2];
}

function segmentsOf(user: string): MockSegment[] {
  const body = block(user, "DOCUMENT") ?? "";
  return body
    .split("\n")
    .map((line) => /^\[(s\d+)\] (.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1] ?? "", text: m[2] ?? "" }));
}

function categoriesOf(system: string): MockCategory[] {
  return [...system.matchAll(/^- ([a-z0-9-]+) \| (.+?) \| (high|medium) \| (.+)$/gm)].map((m) => ({
    id: m[1] ?? "",
    name: m[2] ?? "",
    severity: m[3] === "high" ? "high" : "medium",
    flagWhen: m[4] ?? "",
  }));
}

function basicsOf(system: string): MockBasic[] {
  return [...system.matchAll(/^- ([a-z0-9-]+) \| ([^|\n]+) \| ([a-z0-9-]+)$/gm)].map((m) => ({
    id: m[1] ?? "",
    name: (m[2] ?? "").trim(),
    categoryId: m[3] ?? "",
  }));
}

function jsonBlock<T>(user: string, name: string, fallback: T): T {
  const body = block(user, name);
  if (body === undefined) return fallback;
  try {
    return JSON.parse(body) as T;
  } catch {
    return fallback;
  }
}

/** The sentence holding the match, at most 40 words: an exact span of the line. */
function quoteAround(text: string, at: number): string {
  const before = text.slice(0, at);
  const start = Math.max(before.lastIndexOf(". ") + 2, before.lastIndexOf("; ") + 2, 0);
  const rest = text.slice(at);
  const endMatch = /[.;](?:\s|$)/.exec(rest);
  const end = endMatch === null ? text.length : at + endMatch.index + 1;
  const sentence = text.slice(start, end).trim();
  const words = sentence.split(" ");
  return words.length <= 40 ? sentence : words.slice(0, 40).join(" ");
}

function bestCategory(text: string, categories: MockCategory[]): MockCategory | undefined {
  const words = stems(text);
  let best: MockCategory | undefined;
  let bestScore = 0;
  for (const category of categories) {
    let score = 0;
    for (const stem of stems(`${category.name} ${category.flagWhen}`))
      if (words.has(stem)) score += 1;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 3)}...`;

function findFlags(segments: MockSegment[], categories: MockCategory[]) {
  const flags = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const match = RISK_PHRASES.exec(segment.text);
    if (match === null) continue;
    const category = bestCategory(segment.text, categories);
    if (category === undefined || seen.has(`${segment.id}|${category.id}`)) continue;
    seen.add(`${segment.id}|${category.id}`);
    flags.push({
      id: `f${String(flags.length + 1)}`,
      categoryId: category.id,
      severity: category.severity,
      segmentId: segment.id,
      quote: quoteAround(segment.text, match.index),
      title: clip(`${category.name}: this term may be risky`, 120),
      plain: clip(
        `This part of the document says something about ${category.name.toLowerCase()} that is worth asking about.`,
        600,
      ),
      why: clip(`It matches a common warning sign: ${category.flagWhen.toLowerCase()}.`, 600),
    });
  }
  return flags;
}

function clausesOf(segments: MockSegment[]) {
  return segments
    .filter((s) => s.text.split(" ").length >= 8)
    .map((s) => ({
      segmentId: s.id,
      heading: clip(s.text.split(" ").slice(0, 6).join(" "), 120),
      plain: clip(`In plain words: ${s.text.split(" ").slice(0, 20).join(" ")}`, 600),
    }));
}

function keyFactsOf(segments: MockSegment[]) {
  const facts: { label: string; value: string; segmentId: string }[] = [];
  for (const segment of segments) {
    for (const match of segment.text.matchAll(/Rs\. ?[\d,]+|\b\d+ (?:days|months|years)\b/g)) {
      if (facts.some((f) => f.value === match[0])) continue;
      facts.push({
        label: match[0].startsWith("Rs") ? "Amount" : "Period",
        value: match[0],
        segmentId: segment.id,
      });
    }
  }
  return facts.slice(0, 8);
}

function glossaryOf(text: string) {
  const lower = text.toLowerCase();
  return GLOSSARY.filter(([term]) => lower.includes(term)).map(([term, definition]) => ({
    term,
    definition,
  }));
}

function followUps(refs: { id: string; title: string }[]) {
  return {
    questions: refs.slice(0, 8).map((r) => ({
      text: clip(`Can this be changed or explained: ${r.title}?`, 600),
      refs: [r.id],
    })),
    checklist: {
      before: refs.slice(0, 3).map((r) => ({
        text: clip(`Ask for a written change before signing: ${r.title}`, 600),
        refs: [r.id],
      })),
      after: [{ text: "Keep a signed copy of every page.", refs: [] }],
    },
  };
}

function missingFor(basics: MockBasic[]) {
  return basics.map((basic, i) => ({
    id: `m${String(i + 1)}`,
    basicId: basic.id,
    title: clip(`${basic.name} is not stated`, 120),
    plain: clip(`The document does not say anything about ${basic.name.toLowerCase()}.`, 600),
    why: "Without it, you may not know what to expect.",
  }));
}

function summaryOf(flags: number, missing: number): string {
  return `ClauseClear found ${String(flags)} terms that may be risky and ${String(missing)} basics that seem to be missing. Read the flagged terms before you sign.`;
}

/** The mock model's answer as a JSON-ready object, or undefined for prompts it does not know. */
/** What the mock puts before each "translated" string. */
export const MOCK_HINDI_PREFIX = "हिंदी: ";

export function mockModelAnswer(
  schemaName: string,
  system: string,
  user: string,
): Record<string, unknown> | undefined {
  if (schemaName === "docType") return { docType: "rental", confidence: "high" };

  // Translation: every value marked as Hindi, numbers and symbols untouched.
  if (schemaName === "translation") {
    const strings = jsonBlock<Record<string, string>>(user, "STRINGS", {});
    return Object.fromEntries(
      Object.entries(strings).map(([key, value]) => [key, `${MOCK_HINDI_PREFIX}${value}`]),
    );
  }

  if (schemaName === "synthesis") {
    const flags = jsonBlock<{ id: string; title: string; quote: string }[]>(user, "FLAGS", []);
    const candidates = jsonBlock<unknown[]>(user, "KEY FACT CANDIDATES", []);
    const basics = jsonBlock<{ basicId: string; name: string }[]>(
      user,
      "MISSING BASICS TO CHECK",
      [],
    );
    const missing = missingFor(
      basics.map((b) => ({ id: b.basicId, name: b.name, categoryId: "" })),
    );
    return {
      summary: summaryOf(flags.length, missing.length),
      keyFacts: candidates.slice(0, 8),
      missing,
      ...followUps([...flags, ...missing]),
      glossary: glossaryOf(flags.map((f) => f.quote).join(" ")),
    };
  }

  if (schemaName !== "analysis" && schemaName !== "chunk") return undefined;
  const segments = segmentsOf(user);
  if (segments.length === 0) return undefined;
  const categories = categoriesOf(system);
  const flags = findFlags(segments, categories);
  const flagged = new Set(flags.map((f) => f.categoryId));
  const clauses = clausesOf(segments);
  const keyFacts = keyFactsOf(segments);

  if (schemaName === "chunk") {
    return {
      ...(system.includes('"title": "the document')
        ? { title: clip(segments[0]?.text ?? "Document", 80) }
        : {}),
      coverage: [...flagged].map((categoryId) => ({ categoryId, status: "flagged" })),
      flags,
      clauses,
      keyFacts,
    };
  }

  const basics = basicsOf(system);
  const basicCategories = new Set(basics.map((b) => b.categoryId));
  const coverage = categories.map((c) => ({
    categoryId: c.id,
    status: flagged.has(c.id) ? "flagged" : basicCategories.has(c.id) ? "absent" : "fine",
  }));
  const missing = missingFor(basics.filter((b) => !flagged.has(b.categoryId)));
  return {
    title: clip(segments[0]?.text ?? "Document", 80),
    summary: summaryOf(flags.length, missing.length),
    coverage,
    flags,
    clauses,
    keyFacts,
    missing,
    ...followUps([...flags, ...missing]),
    glossary: glossaryOf(segments.map((s) => s.text).join(" ")),
  };
}
