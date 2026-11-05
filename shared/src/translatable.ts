// Everything the tool writes can be translated; quotes, segments, the document
// title and glossary terms stay in the original English (SPEC section 2 language rule).
import type { AnalysisResult, ChecklistItem, TranslationMap } from "./schemas.js";

type Visit = (key: string, value: string) => string;

// AnalysisResult is plain JSON, so a JSON round trip is a complete copy and works in
// every runtime the shared package targets (structuredClone is not in the ES lib).
function deepCopy(result: AnalysisResult): AnalysisResult {
  return JSON.parse(JSON.stringify(result)) as AnalysisResult;
}

/** Rebuilds the result with every translatable string passed through visit, in a fixed key order. */
function mapStrings(r: AnalysisResult, visit: Visit): AnalysisResult {
  const items = (prefix: string, list: ChecklistItem[]) =>
    list.map((item) => ({ ...item, text: visit(`${prefix}.${item.id}.text`, item.text) }));

  return {
    ...r,
    docTypeLabel: visit("docTypeLabel", r.docTypeLabel),
    summary: visit("summary", r.summary),
    keyFacts: r.keyFacts.map((k) => ({
      ...k,
      label: visit(`keyFacts.${k.id}.label`, k.label),
      value: visit(`keyFacts.${k.id}.value`, k.value),
    })),
    flags: r.flags.map((f) => ({
      ...f,
      category: visit(`flags.${f.id}.category`, f.category),
      title: visit(`flags.${f.id}.title`, f.title),
      plain: visit(`flags.${f.id}.plain`, f.plain),
      why: visit(`flags.${f.id}.why`, f.why),
    })),
    clauses: r.clauses.map((c) => ({
      ...c,
      heading: visit(`clauses.${c.id}.heading`, c.heading),
      plain: visit(`clauses.${c.id}.plain`, c.plain),
    })),
    questions: r.questions.map((q) => ({ ...q, text: visit(`questions.${q.id}.text`, q.text) })),
    checklist: {
      before: items("checklist.before", r.checklist.before),
      after: items("checklist.after", r.checklist.after),
    },
    glossary: r.glossary.map((g) => ({
      ...g,
      definition: visit(`glossary.${g.id}.definition`, g.definition),
    })),
  };
}

/** Flat map of every translatable string, keyed by path (e.g. "flags.f1.plain"). */
export function extractTranslatable(result: AnalysisResult): TranslationMap {
  const map: TranslationMap = {};
  mapStrings(result, (key, value) => {
    map[key] = value;
    return value;
  });
  return map;
}

/**
 * Returns a new result with translated strings applied. Keys missing from the
 * map stay English; unknown keys are ignored. The input is never mutated.
 */
export function applyTranslations(result: AnalysisResult, map: TranslationMap): AnalysisResult {
  return mapStrings(deepCopy(result), (key, value) =>
    Object.hasOwn(map, key) ? (map[key] ?? value) : value,
  );
}

/**
 * Every key extractTranslatable can produce, and nothing else: quotes, segments,
 * the title and glossary terms are never keys (A18), so /api/translate refuses them.
 */
const TRANSLATABLE_KEY =
  /^(?:docTypeLabel|summary|keyFacts.[^.]+.(?:label|value)|flags.[^.]+.(?:category|title|plain|why)|clauses.[^.]+.(?:heading|plain)|questions.[^.]+.text|checklist.(?:before|after).[^.]+.text|glossary.[^.]+.definition)$/;

export function isTranslatableKey(key: string): boolean {
  return TRANSLATABLE_KEY.test(key);
}
