import type { ChecklistItem } from "@clauseclear/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { RuledSheet } from "../components/motifs/RuledSheet";
import { useT } from "../i18n/useT";
import { checklistProgress, checklistText, itemTag, type ItemTag } from "../lib/checklist";
import { copyText } from "../lib/clipboard";
import { flagNumbers } from "../lib/document";
import { useAnalysis, useResultView, useUi } from "../state/hooks";
import { app } from "../state/instance";

/** Sent with a tag's link, so the results page can bring that flag into view. */
export interface FocusFlagState {
  focusFlag: string;
}

/**
 * The before-and-after checklist (SPEC F17, design.md 5.4). It reads the same
 * store as the results page. Ticks live in sessionStorage by analysis id (the UI
 * store writes them) and reset on a new analysis. Each item a flag raised carries
 * a stamp-style tag that links back to that flag on the results page.
 */
export function Checklist() {
  const t = useT();
  const view = useResultView();
  const { ticks } = useUi();
  const { current, loadingSample } = useAnalysis();
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const copiedTimer = useRef<number | undefined>(undefined);
  const english = current?.result;
  const numbers = useMemo(() => flagNumbers(english?.flags ?? []), [english]);

  // Arriving from the bottom of the results page, start at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (view === null && loadingSample !== null) {
    // The landing page's "Open the sample checklist" link loads a sample first.
    return (
      <div className="cc-page cc-shell">
        <p role="status">{t("landing.openingSample")}</p>
      </div>
    );
  }
  if (view === null || current === null) {
    return <Navigate to="/" replace state={{ note: "resultGone" }} />;
  }

  const { result, translating, translateFailed } = view;
  const { before, after } = result.checklist;
  const progress = checklistProgress(result.checklist, ticks);
  // Until the Hindi arrives, the item text on screen is English.
  const dynamicLang = translating || translateFailed ? "en" : undefined;
  const resultsPath =
    current.source === "sample" ? `/results/sample/${current.sampleId}` : "/results";
  const fileName = current.source === "run" ? (current.fileName ?? result.title) : result.title;
  const doneText = t("checklist.done", { done: progress.done, total: progress.total });

  const tagOf = (item: ChecklistItem) => itemTag(item, result.flags, numbers);
  const flagLabel = (entry: ItemTag["flags"][number]) =>
    entry.flag.kind === "missing"
      ? t("checklist.missingTag")
      : t("checklist.flagTag", { n: entry.n, category: entry.flag.category });
  const numberList = (tag: ItemTag) => tag.flags.map((entry) => String(entry.n));
  const joinNumbers = (list: string[]) =>
    list.length < 2
      ? list.join("")
      : `${list.slice(0, -1).join(", ")}${t("checklist.listJoin")}${list.at(-1) ?? ""}`;
  const tagText = (item: ChecklistItem): string | null => {
    const tag = tagOf(item);
    if (tag === null) return null;
    const [only] = tag.flags;
    if (tag.flags.length === 1 && only !== undefined) return flagLabel(only);
    return t("checklist.flagsTag", { list: joinNumbers(numberList(tag)) });
  };

  // One stamp per flag, each a link to that flag on the results page. With one
  // flag the stamp names its category ("Flag 2 · Deposit"); with several, the
  // stamps carry the numbers and their accessible names carry the categories.
  const renderTag = (item: ChecklistItem) => {
    const tag = tagOf(item);
    if (tag === null) return null;
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
  };

  const sheet = (
    key: "before" | "after",
    heading: string,
    items: readonly ChecklistItem[],
    variant: "notebook" | "legal",
  ) => (
    <section
      className={`cc-checklist__sheet cc-checklist__sheet--${key}`}
      aria-labelledby={`${key}-heading`}
    >
      <h2 id={`${key}-heading`} className="cc-checklist__h2">
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

  const copyAsText = async () => {
    const text = checklistText(result.checklist, ticks, {
      title: t("checklist.h1"),
      progress: doneText,
      before: t("checklist.beforeHeading"),
      after: t("checklist.afterHeading"),
      tag: tagText,
    });
    const ok = await copyText(text);
    setStatus(ok ? t("common.copied") : t("results.copyFailed"));
    setCopied(ok);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="cc-page cc-checklist">
      <Link className="cc-mono-link cc-checklist__back" to={resultsPath}>
        {t("checklist.back")}
      </Link>
      <div className="cc-checklist__top">
        <div className="cc-checklist__intro-block">
          <h1 className="cc-checklist__title">{t("checklist.h1")}</h1>
          <p className="cc-checklist__intro">{t("checklist.intro")}</p>
          <p className="cc-checklist__based">{t("checklist.basedOn", { file: fileName })}</p>
        </div>
        <div className="cc-checklist__actions">
          <button
            type="button"
            className="cc-button cc-button--secondary"
            onClick={() => {
              window.print();
            }}
          >
            {t("checklist.print")}
          </button>
          <button
            type="button"
            className="cc-button cc-button--secondary"
            onClick={() => {
              void copyAsText();
            }}
          >
            {copied ? t("common.copied") : t("checklist.copyText")}
          </button>
        </div>
      </div>

      <div className="cc-progress">
        <p className="cc-progress__count">{doneText}</p>
        <p className="cc-progress__split">
          {t("checklist.split", {
            b: progress.b,
            bn: progress.bn,
            a: progress.a,
            an: progress.an,
          })}
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

      <div className="cc-checklist__sheets">
        {sheet("before", t("checklist.beforeHeading"), before, "notebook")}
        {sheet("after", t("checklist.afterHeading"), after, "legal")}
      </div>

      <p className="cc-checklist__footnote">{t("checklist.footnote")}</p>
      <p className="cc-visually-hidden" aria-live="polite" data-testid="copy-status">
        {status}
      </p>
    </div>
  );
}
