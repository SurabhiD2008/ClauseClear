import type { DocType, Flag, GlossaryEntry, Lang } from "@clauseclear/shared";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLanguage, useT } from "../../i18n/useT";
import { flagNumbers, segmentNumber } from "../../lib/document";
import { usePrinting } from "../../lib/useBrowserState";
import { PHONE_QUERY, SHEET_QUERY, useMediaQuery } from "../../lib/useMediaQuery";
import { useAnalysis, useResultView, useUi } from "../../state/hooks";
import type { FocusFlagState } from "../../routes/Checklist";
import { app } from "../../state/instance";
import { LeaderRow } from "../motifs/LeaderRow";
import { BottomSheet } from "./BottomSheet";
import { ClauseLedger } from "./ClauseLedger";
import { DocumentViewer } from "./DocumentViewer";
import type { GlossaryNote } from "../GlossaryText";
import { FlagList, type FlagNotes } from "./FlagList";
import { Questions } from "./Questions";
import { Verdict } from "./Verdict";

/**
 * The results page (SPEC F3 to F12, design.md 5.2). Findings on the left, the
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
  // The control that opened the sheet; focus goes back to it on close.
  const trigger = useRef<HTMLElement | null>(null);

  const english = current?.result;
  const numbers = useMemo(() => flagNumbers(english?.flags ?? []), [english]);
  const notesFor = useMemo(() => {
    const shown = new Map((view?.result.glossary ?? []).map((g) => [g.id, g]));
    const original = new Map((english?.glossary ?? []).map((g) => [g.id, g]));
    return (flag: Flag): FlagNotes => {
      const entries = flag.termIds
        .map((id) => [shown.get(id), original.get(id)] as const)
        .filter(
          (pair): pair is readonly [GlossaryEntry, GlossaryEntry] =>
            pair[0] !== undefined && pair[1] !== undefined,
        );
      return {
        text: entries.map(([s]) => ({
          id: s.id,
          term: s.term,
          title: s.term,
          definition: s.definition,
        })),
        quote: entries.map(([s, o]) => ({
          id: s.id,
          term: o.term,
          title: s.term,
          definition: s.definition,
        })),
      };
    };
  }, [view, english]);
  // Every term, for the clause readings (matched in the page language) and the
  // document (matched in English, the document's language).
  const allNotes = useMemo(() => {
    const original = new Map((english?.glossary ?? []).map((g) => [g.id, g]));
    const text: GlossaryNote[] = [];
    const doc: GlossaryNote[] = [];
    for (const shown of view?.result.glossary ?? []) {
      const note = { id: shown.id, title: shown.term, definition: shown.definition };
      text.push({ ...note, term: shown.term });
      doc.push({ ...note, term: original.get(shown.id)?.term ?? shown.term });
    }
    return { text, doc };
  }, [view, english]);

  // A checklist tag links here with its flag already selected: bring it into view.
  const location = useLocation();
  const focusFlag = (location.state as Partial<FocusFlagState> | null)?.focusFlag;
  const hasResult = current !== null;
  useEffect(() => {
    if (focusFlag === undefined || !hasResult) return;
    const head = document.querySelector<HTMLElement>(
      `[data-flag-id="${focusFlag}"] .cc-flag__head`,
    );
    if (head === null) return;
    head.focus({ preventScroll: true });
    head.scrollIntoView({ block: "center" });
  }, [focusFlag, hasResult, location.key]);

  const openSheet = useCallback((from: HTMLElement) => {
    trigger.current = from;
    app.ui.setSheetOpen(true);
  }, []);
  const onSelect = useCallback(
    (flagId: string | null, from: HTMLElement) => {
      app.ui.selectFlag(flagId);
      // Below 1024 px, selecting a flag with a clause opens the document at it (SPEC section 9).
      const flag = english?.flags.find((f) => f.id === flagId);
      if (narrow && flag?.kind === "present") openSheet(from);
    },
    [english, narrow, openSheet],
  );
  const onFind = useCallback(
    (flagId: string, from: HTMLElement) => {
      app.ui.selectFlag(flagId);
      openSheet(from);
    },
    [openSheet],
  );
  // "Not right? Change it": the same input again with the chosen type. Starting
  // the run clears the result, and the /results route then hands over to the
  // landing page, which shows the progress and moves on to the new result.
  const input = current?.source === "run" ? current.input : null;
  const onRerun = useCallback(
    (docType: DocType) => {
      if (input === null) return;
      void app.analysis.start({ ...input, docType });
    },
    [input],
  );

  const returnFocus = useCallback(() => {
    if (trigger.current?.isConnected === true) return trigger.current;
    const id = app.ui.getState().selectedFlagId;
    return document.querySelector<HTMLElement>(`[data-flag-id="${id ?? ""}"] .cc-flag__head`);
  }, []);

  if (current === null || view === null) return null;
  const { result, translating, translateFailed } = view;
  // Until the Hindi arrives, the dynamic text on screen is English.
  const dynamicLang = translating || translateFailed ? "en" : undefined;
  const speechLang: Lang = dynamicLang === "en" ? "en" : lang;
  const name = current.source === "run" ? (current.fileName ?? result.title) : result.title;
  const pages = result.stats.pages;
  const selected = result.flags.find((flag) => flag.id === selectedFlagId);
  const sheetTitle =
    selected?.segmentId === undefined
      ? t("results.docHeading")
      : t("results.sheetTitle", { n: segmentNumber(selected.segmentId) });

  return (
    <div className="cc-page cc-results">
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

      {/* Translating, translation failed and offline are in the fixed status bar (StatusBar). */}
      {result.warnings.length > 0 && (
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
      )}

      <div className="cc-results__grid">
        <div className="cc-results__main">
          <Verdict
            result={result}
            dynamicLang={dynamicLang}
            speechLang={speechLang}
            onRerun={input === null ? undefined : onRerun}
          />

          {result.keyFacts.length > 0 && (
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
          )}

          <FlagList
            flags={result.flags}
            numbers={numbers}
            filter={filter}
            selectedFlagId={selectedFlagId}
            notesFor={notesFor}
            dynamicLang={dynamicLang}
            speechLang={speechLang}
            onFilter={app.changeFilter}
            onSelect={onSelect}
            onFind={narrow ? onFind : undefined}
            initialCount={phone && !printing ? 3 : undefined}
          />

          <ClauseLedger clauses={result.clauses} notes={allNotes.text} dynamicLang={dynamicLang} />
          <Questions questions={result.questions} dynamicLang={dynamicLang} />

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
        </div>

        {!narrow && (
          <aside className="cc-results__aside" aria-label={t("results.docHeading")}>
            <DocumentViewer
              result={result}
              numbers={numbers}
              selectedFlagId={selectedFlagId}
              notes={allNotes.doc}
            />
          </aside>
        )}
      </div>

      {narrow && (
        <BottomSheet
          open={sheetOpen}
          title={sheetTitle}
          onClose={() => {
            app.ui.setSheetOpen(false);
          }}
          returnFocus={returnFocus}
        >
          <DocumentViewer
            result={result}
            numbers={numbers}
            selectedFlagId={selectedFlagId}
            notes={allNotes.doc}
            bar={false}
          />
        </BottomSheet>
      )}
    </div>
  );
}
