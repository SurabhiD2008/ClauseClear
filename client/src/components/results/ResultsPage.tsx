import type { AnalysisResult, DocType, Lang } from "@clauseclear/shared";
import { useMemo, type ComponentProps } from "react";
import { Link } from "react-router-dom";
import { useLanguage, useT } from "../../i18n/useT";
import { flagNumbers, segmentNumber } from "../../lib/document";
import { usePrinting } from "../../lib/useBrowserState";
import { PHONE_QUERY, SHEET_QUERY, useMediaQuery } from "../../lib/useMediaQuery";
import { useAnalysis, useResultView, useUi } from "../../state/hooks";
import { app } from "../../state/instance";
import { LeaderRow } from "../motifs/LeaderRow";
import { BottomSheet } from "./BottomSheet";
import { ClauseLedger } from "./ClauseLedger";
import { DocumentViewer } from "./DocumentViewer";
import type { GlossaryNote } from "../GlossaryText";
import { FlagList } from "./FlagList";
import { Questions } from "./Questions";
import { useFocusFlagFromChecklist, useGlossaryNotes, useResultHandlers } from "./resultsHooks";
import { Verdict } from "./Verdict";

function ResultsTop({ name, pages, sample }: { name: string; pages: number; sample: boolean }) {
  const t = useT();
  return (
    <div className="cc-results__top">
      <p className="cc-results__file">
        <span className="cc-results__name" lang="en">
          {name}
        </span>
        <span className="cc-results__meta">
          {t(pages === 1 ? "results.fileMetaOne" : "results.fileMeta", { pages })}
        </span>
        {sample && <span className="cc-stamp cc-stamp--sample">{t("results.sampleTag")}</span>}
      </p>
      <div className="cc-results__actions">
        <button
          type="button"
          className="cc-button cc-button--secondary cc-button--compact"
          onClick={() => {
            window.print();
          }}
        >
          {t("results.saveReport")}
        </button>
        <Link className="cc-button cc-button--primary cc-button--compact" to="/">
          {t("results.checkAnother")}
        </Link>
      </div>
    </div>
  );
}

/** Translating, translation failed and offline are in the fixed status bar (StatusBar). */
function Notices({ result }: { result: AnalysisResult }) {
  const t = useT();
  if (result.warnings.length === 0) return null;
  return (
    <div className="cc-results__notices">
      {result.warnings.includes("partial_verification") && (
        <p className="cc-notice" data-warning="partial_verification">
          {t("results.warningPartial")}
        </p>
      )}
      {result.warnings.includes("low_confidence_type") && (
        <p className="cc-notice" data-warning="low_confidence_type">
          {t("results.warningLowType", { type: result.docTypeLabel })}
        </p>
      )}
    </div>
  );
}

function KeyFacts({
  result,
  dynamicLang,
}: {
  result: AnalysisResult;
  dynamicLang: string | undefined;
}) {
  const t = useT();
  if (result.keyFacts.length === 0) return null;
  return (
    <section className="cc-facts" aria-labelledby="facts-heading">
      <h2 id="facts-heading" className="cc-results__h2">
        {t("results.factsHeading")}
      </h2>
      <dl className="cc-facts__grid" lang={dynamicLang}>
        {result.keyFacts.map((fact) => (
          <LeaderRow key={fact.id} label={fact.label} value={fact.value} />
        ))}
      </dl>
    </section>
  );
}

function ResultsFooterLinks() {
  const t = useT();
  return (
    <>
      <p className="cc-results__next">
        <Link
          className="cc-mono-link"
          to="/checklist"
          onClick={() => {
            app.dispatch({ type: "TO_CHECKLIST" });
          }}
        >
          {t("results.nextLink")}
        </Link>
      </p>
      <p className="cc-results__disclaimer">{t("results.disclaimer")}</p>
    </>
  );
}

function MainColumn({
  result,
  dynamicLang,
  speechLang,
  onRerun,
  flagList,
  clauseNotes,
}: {
  result: AnalysisResult;
  dynamicLang: string | undefined;
  speechLang: Lang;
  onRerun: ((docType: DocType) => void) | undefined;
  flagList: ComponentProps<typeof FlagList>;
  clauseNotes: readonly GlossaryNote[];
}) {
  return (
    <div className="cc-results__main">
      <Verdict
        result={result}
        dynamicLang={dynamicLang}
        speechLang={speechLang}
        onRerun={onRerun}
      />
      <KeyFacts result={result} dynamicLang={dynamicLang} />
      <FlagList {...flagList} />
      <ClauseLedger clauses={result.clauses} notes={clauseNotes} dynamicLang={dynamicLang} />
      <Questions questions={result.questions} dynamicLang={dynamicLang} />
      <ResultsFooterLinks />
    </div>
  );
}

/** Below 1024 px the document is a bottom sheet, titled with the selected flag's clause. */
function DocumentSheet({
  open,
  viewer,
  returnFocus,
}: {
  open: boolean;
  viewer: ComponentProps<typeof DocumentViewer>;
  returnFocus: () => HTMLElement | null;
}) {
  const t = useT();
  const selected = viewer.result.flags.find((flag) => flag.id === viewer.selectedFlagId);
  const title =
    selected?.segmentId === undefined
      ? t("results.docHeading")
      : t("results.sheetTitle", { n: segmentNumber(selected.segmentId) });
  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={() => {
        app.ui.setSheetOpen(false);
      }}
      returnFocus={returnFocus}
    >
      <DocumentViewer {...viewer} bar={false} />
    </BottomSheet>
  );
}

/**
 * The results page. Findings on the left, the
 * document viewer in a sticky aside on the right. Text from the analysis shows
 * in Hindi once its translation is ready; quotes and the document stay English.
 */
export function ResultsPage({ sample }: { sample: boolean }) {
  const t = useT();
  const { current } = useAnalysis();
  const view = useResultView();
  const { lang } = useLanguage();
  const { selectedFlagId, filter, sheetOpen } = useUi();
  const narrow = useMediaQuery(SHEET_QUERY);
  const phone = useMediaQuery(PHONE_QUERY);
  // The printed report lists every flag, even on a phone.
  const printing = usePrinting();
  const english = current?.result;
  const numbers = useMemo(() => flagNumbers(english?.flags ?? []), [english]);
  const { notesFor, allNotes } = useGlossaryNotes(view, english);
  useFocusFlagFromChecklist(current !== null);
  const { onSelect, onFind, onRerun, returnFocus } = useResultHandlers(current, english, narrow);

  if (current === null || view === null) return null;
  const { result, translating, translateFailed } = view;
  // Until the Hindi arrives, the dynamic text on screen is English.
  const dynamicLang = translating || translateFailed ? "en" : undefined;
  const speechLang: Lang = dynamicLang === "en" ? "en" : lang;
  const name = current.source === "run" ? (current.fileName ?? result.title) : result.title;
  const viewer = { result, numbers, selectedFlagId, notes: allNotes.doc };

  return (
    <div className="cc-page cc-results">
      <ResultsTop name={name} pages={result.stats.pages} sample={sample} />
      <Notices result={result} />
      <div className="cc-results__grid">
        <MainColumn
          result={result}
          dynamicLang={dynamicLang}
          speechLang={speechLang}
          onRerun={onRerun}
          flagList={{
            flags: result.flags,
            numbers,
            filter,
            selectedFlagId,
            notesFor,
            dynamicLang,
            speechLang,
            onFilter: app.changeFilter,
            onSelect,
            onFind: narrow ? onFind : undefined,
            initialCount: phone && !printing ? 3 : undefined,
          }}
          clauseNotes={allNotes.text}
        />
        {!narrow && (
          <aside className="cc-results__aside" aria-label={t("results.docHeading")}>
            <DocumentViewer {...viewer} />
          </aside>
        )}
      </div>
      {narrow && <DocumentSheet open={sheetOpen} viewer={viewer} returnFocus={returnFocus} />}
    </div>
  );
}
