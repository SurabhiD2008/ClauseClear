// Pieces of the checklist page: the tags that link an item to its flags, one
// ruled sheet of items, the progress block and the copy-as-text action.
import type { ChecklistItem, Flag } from "@clauseclear/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RuledSheet } from "../components/motifs/RuledSheet";
import { useT } from "../i18n/useT";
import { itemTag, type ChecklistProgress, type ItemTag } from "../lib/checklist";
import { copyText } from "../lib/clipboard";
import { app } from "../state/instance";

/** Sent with a tag's link, so the results page can bring that flag into view. */
export interface FocusFlagState {
  focusFlag: string;
}

type T = ReturnType<typeof useT>;
type TagEntry = ItemTag["flags"][number];

/** How a checklist item's flags are named: on its stamps and in the copied text. */
export function tagNaming(t: T, flags: readonly Flag[], numbers: ReadonlyMap<string, number>) {
  const tagOf = (item: ChecklistItem) => itemTag(item, flags, numbers);
  const flagLabel = (entry: TagEntry) =>
    entry.flag.kind === "missing"
      ? t("checklist.missingTag")
      : t("checklist.flagTag", { n: entry.n, category: entry.flag.category });
  const joinNumbers = (list: string[]) =>
    list.length < 2
      ? list.join("")
      : `${list.slice(0, -1).join(", ")}${t("checklist.listJoin")}${list.at(-1) ?? ""}`;
  const tagText = (item: ChecklistItem): string | null => {
    const tag = tagOf(item);
    if (tag === null) return null;
    const [only] = tag.flags;
    if (tag.flags.length === 1 && only !== undefined) return flagLabel(only);
    return t("checklist.flagsTag", {
      list: joinNumbers(tag.flags.map((entry) => String(entry.n))),
    });
  };
  return { tagOf, flagLabel, tagText };
}

/**
 * One stamp per flag, each a link to that flag on the results page. With one
 * flag the stamp names its category ("Flag 2 · Deposit"); with several, the
 * stamps carry the numbers and their accessible names carry the categories.
 */
export function TagLinks({
  tag,
  resultsPath,
  flagLabel,
}: {
  tag: ItemTag;
  resultsPath: string;
  flagLabel: (entry: TagEntry) => string;
}) {
  const t = useT();
  const several = tag.flags.length > 1;
  return (
    <span className="cc-check__tags">
      {tag.flags.map((entry) => {
        const tone = entry.flag.kind === "missing" ? "missing" : entry.flag.severity;
        const label = flagLabel(entry);
        return (
          <Link
            key={entry.flag.id}
            className="cc-check__tag"
            to={resultsPath}
            state={{ focusFlag: entry.flag.id } satisfies FocusFlagState}
            aria-label={several ? label : undefined}
            onClick={() => {
              app.ui.selectFlag(entry.flag.id);
            }}
          >
            <span className={`cc-stamp cc-stamp--${tone}`}>
              {several && entry.flag.kind === "present"
                ? t("common.flagNumber", { n: entry.n })
                : label}
            </span>
          </Link>
        );
      })}
    </span>
  );
}

export function ChecklistSheet({
  kind,
  heading,
  items,
  variant,
  ticks,
  dynamicLang,
  renderTag,
}: {
  kind: "before" | "after";
  heading: string;
  items: readonly ChecklistItem[];
  variant: "notebook" | "legal";
  ticks: readonly string[];
  dynamicLang: string | undefined;
  renderTag: (item: ChecklistItem) => React.ReactNode;
}) {
  return (
    <section
      className={`cc-checklist__sheet cc-checklist__sheet--${kind}`}
      aria-labelledby={`${kind}-heading`}
    >
      <h2 id={`${kind}-heading`} className="cc-checklist__h2">
        {heading}
      </h2>
      <RuledSheet variant={variant}>
        <ul className="cc-checks">
          {items.map((item) => {
            const ticked = ticks.includes(item.id);
            const id = `check-${item.id}`;
            return (
              <li key={item.id} className="cc-check" data-item-id={item.id} data-ticked={ticked}>
                <input
                  id={id}
                  type="checkbox"
                  className="cc-check__box"
                  checked={ticked}
                  onChange={() => {
                    app.ui.toggleTick(item.id);
                  }}
                />
                <label htmlFor={id} className="cc-check__text" lang={dynamicLang}>
                  {item.text}
                </label>
                {renderTag(item)}
              </li>
            );
          })}
        </ul>
      </RuledSheet>
    </section>
  );
}

export function ProgressBlock({
  progress,
  doneText,
}: {
  progress: ChecklistProgress;
  doneText: string;
}) {
  const t = useT();
  return (
    <div className="cc-progress">
      <p className="cc-progress__count">{doneText}</p>
      <p className="cc-progress__split">
        {t("checklist.split", { b: progress.b, bn: progress.bn, a: progress.a, an: progress.an })}
      </p>
      <div
        className="cc-progress__bar"
        role="progressbar"
        aria-label={t("checklist.progressLabel")}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-valuetext={doneText}
      >
        <span className="cc-progress__fill" style={{ width: `${String(progress.percent)}%` }} />
      </div>
    </div>
  );
}

/** Copies text, shows "Copied" on the button for two seconds and announces the outcome. */
export function useCopyStatus(t: T) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(copiedTimer.current);
    },
    [],
  );
  const copy = async (text: string) => {
    const ok = await copyText(text);
    setStatus(ok ? t("common.copied") : t("results.copyFailed"));
    setCopied(ok);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  };
  return { copied, status, copy };
}
