import type { AnalysisResult } from "@clauseclear/shared";
import { useEffect, useMemo, type ComponentProps } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/useT";
import { checklistProgress, checklistText } from "../lib/checklist";
import { flagNumbers } from "../lib/document";
import { useAnalysis, useResultView, useUi } from "../state/hooks";
import {
  ChecklistSheet,
  ProgressBlock,
  TagLinks,
  tagNaming,
  useCopyStatus,
} from "./checklistParts";

export type { FocusFlagState } from "./checklistParts";

function ChecklistTop({
  fileName,
  copied,
  onCopy,
}: {
  fileName: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const t = useT();
  return (
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
        <button type="button" className="cc-button cc-button--secondary" onClick={onCopy}>
          {copied ? t("common.copied") : t("checklist.copyText")}
        </button>
      </div>
    </div>
  );
}

/** The two ruled sheets: before signing (notebook paper) and after (a legal pad). */
function Sheets({
  checklist,
  sheet,
}: {
  checklist: AnalysisResult["checklist"];
  sheet: Pick<ComponentProps<typeof ChecklistSheet>, "ticks" | "dynamicLang" | "renderTag">;
}) {
  const t = useT();
  return (
    <div className="cc-checklist__sheets">
      <ChecklistSheet
        {...sheet}
        kind="before"
        heading={t("checklist.beforeHeading")}
        items={checklist.before}
        variant="notebook"
      />
      <ChecklistSheet
        {...sheet}
        kind="after"
        heading={t("checklist.afterHeading")}
        items={checklist.after}
        variant="legal"
      />
    </div>
  );
}

/**
 * The before-and-after checklist. It reads the same
 * store as the results page. Ticks live in sessionStorage by analysis id (the UI
 * store writes them) and reset on a new analysis. Each item a flag raised carries
 * a stamp-style tag that links back to that flag on the results page.
 */
export function Checklist() {
  const t = useT();
  const view = useResultView();
  const { current, loadingSample } = useAnalysis();
  // Arriving from the bottom of the results page, start at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
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
  return <ChecklistBody view={view} current={current} />;
}

function ChecklistBody({
  view,
  current,
}: {
  view: NonNullable<ReturnType<typeof useResultView>>;
  current: NonNullable<ReturnType<typeof useAnalysis>["current"]>;
}) {
  const t = useT();
  const { ticks } = useUi();
  const { copied, status, copy } = useCopyStatus(t);
  const english = current.result;
  const numbers = useMemo(() => flagNumbers(english.flags), [english]);
  const { result, translating, translateFailed } = view;
  const progress = checklistProgress(result.checklist, ticks);
  // Until the Hindi arrives, the item text on screen is English.
  const dynamicLang = translating || translateFailed ? "en" : undefined;
  const resultsPath =
    current.source === "sample" ? `/results/sample/${current.sampleId}` : "/results";
  const fileName = current.source === "run" ? (current.fileName ?? result.title) : result.title;
  const doneText = t("checklist.done", { done: progress.done, total: progress.total });
  const { tagOf, flagLabel, tagText } = tagNaming(t, result.flags, numbers);
  const renderTag = (item: (typeof result.checklist.before)[number]) => {
    const tag = tagOf(item);
    return tag === null ? null : (
      <TagLinks tag={tag} resultsPath={resultsPath} flagLabel={flagLabel} />
    );
  };
  const copyAsText = () => {
    const headings = { before: t("checklist.beforeHeading"), after: t("checklist.afterHeading") };
    void copy(
      checklistText(result.checklist, ticks, {
        title: t("checklist.h1"),
        progress: doneText,
        ...headings,
        tag: tagText,
      }),
    );
  };
  const sheet = { ticks, dynamicLang, renderTag };

  return (
    <div className="cc-page cc-checklist">
      <Link className="cc-mono-link cc-checklist__back" to={resultsPath}>
        {t("checklist.back")}
      </Link>
      <ChecklistTop fileName={fileName} copied={copied} onCopy={copyAsText} />
      <ProgressBlock progress={progress} doneText={doneText} />
      <Sheets checklist={result.checklist} sheet={sheet} />
      <p className="cc-checklist__footnote">{t("checklist.footnote")}</p>
      <p className="cc-visually-hidden" aria-live="polite" data-testid="copy-status">
        {status}
      </p>
    </div>
  );
}
