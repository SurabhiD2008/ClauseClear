// Pure helpers for the checklist page (SPEC F17): progress counts and the
// "Copy as text" export. Ticks are item ids; ids no longer on the list are ignored.
import type { AnalysisResult, ChecklistItem, Flag } from "@clauseclear/shared";

export interface ChecklistProgress {
  done: number;
  total: number;
  /** Before signing: ticked, of all. */
  b: number;
  bn: number;
  /** After signing: ticked, of all. */
  a: number;
  an: number;
  /** 0 to 100, for the bar. */
  percent: number;
}

export function checklistProgress(
  checklist: AnalysisResult["checklist"],
  ticks: readonly string[],
): ChecklistProgress {
  const ticked = new Set(ticks);
  const count = (items: readonly ChecklistItem[]) =>
    items.filter((item) => ticked.has(item.id)).length;
  const b = count(checklist.before);
  const a = count(checklist.after);
  const bn = checklist.before.length;
  const an = checklist.after.length;
  const total = bn + an;
  const done = a + b;
  return { done, total, b, bn, a, an, percent: total === 0 ? 0 : (done / total) * 100 };
}

export interface ItemTag {
  /** The flags it links to, in ranked order, with their numbers. */
  flags: { flag: Flag; n: number }[];
  /** The colour of the stamp: the worst flag it names. */
  tone: "high" | "medium" | "missing";
}

/** The tag on an item raised by flags; null for an item no flag raised. */
export function itemTag(
  item: ChecklistItem,
  flags: readonly Flag[],
  numbers: ReadonlyMap<string, number>,
): ItemTag | null {
  const linked = item.flagIds
    .map((id) => flags.find((flag) => flag.id === id))
    .filter((flag): flag is Flag => flag !== undefined)
    .map((flag) => ({ flag, n: numbers.get(flag.id) ?? 0 }))
    .sort((x, y) => x.n - y.n);
  if (linked.length === 0) return null;
  const present = linked.filter(({ flag }) => flag.kind === "present");
  const tone =
    present.length === 0
      ? "missing"
      : present.some(({ flag }) => flag.severity === "high")
        ? "high"
        : "medium";
  return { flags: linked, tone };
}

export interface ChecklistTextLabels {
  title: string;
  progress: string;
  before: string;
  after: string;
  /** The tag as it reads on the page, for an item that has one. */
  tag: (item: ChecklistItem) => string | null;
}

/** Plain text for "Copy as text": headings, then "[x]" or "[ ]" and each item with its tag. */
export function checklistText(
  checklist: AnalysisResult["checklist"],
  ticks: readonly string[],
  labels: ChecklistTextLabels,
): string {
  const ticked = new Set(ticks);
  const lines = (items: readonly ChecklistItem[]) =>
    items.map((item) => {
      const tag = labels.tag(item);
      return `${ticked.has(item.id) ? "[x]" : "[ ]"} ${item.text}${tag === null ? "" : ` (${tag})`}`;
    });
  return [
    labels.title,
    labels.progress,
    "",
    labels.before,
    ...lines(checklist.before),
    "",
    labels.after,
    ...lines(checklist.after),
  ].join("\n");
}
