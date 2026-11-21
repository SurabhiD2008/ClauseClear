// The results page's state logic: glossary notes per flag and for the page,
// focus for a flag reached from the checklist, and the selection, sheet and
// re-run handlers.
import type { AnalysisResult, DocType, Flag, GlossaryEntry } from "@clauseclear/shared";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { FocusFlagState } from "../../routes/Checklist";
import { useAnalysis, useResultView } from "../../state/hooks";
import { app } from "../../state/instance";
import type { GlossaryNote } from "../GlossaryText";
import type { FlagNotes } from "./FlagList";

type Current = ReturnType<typeof useAnalysis>["current"];
type View = ReturnType<typeof useResultView>;

/**
 * Glossary notes for each flag (its own terms) and for the whole page: shown in
 * the page language, matched in English inside quotes and the document.
 */
export function useGlossaryNotes(view: View, english: AnalysisResult | undefined) {
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
  return { notesFor, allNotes };
}

/** A checklist tag links here with its flag already selected: bring it into view. */
export function useFocusFlagFromChecklist(hasResult: boolean): void {
  const location = useLocation();
  const focusFlag = (location.state as Partial<FocusFlagState> | null)?.focusFlag;
  useEffect(() => {
    if (focusFlag === undefined || !hasResult) return;
    const head = document.querySelector<HTMLElement>(
      `[data-flag-id="${focusFlag}"] .cc-flag__head`,
    );
    if (head === null) return;
    head.focus({ preventScroll: true });
    head.scrollIntoView({ block: "center" });
  }, [focusFlag, hasResult, location.key]);
}

/** Flag selection, the bottom sheet and "Not right? Change it". */
export function useResultHandlers(
  current: Current,
  english: AnalysisResult | undefined,
  narrow: boolean,
) {
  // The control that opened the sheet; focus goes back to it on close.
  const trigger = useRef<HTMLElement | null>(null);
  const openSheet = useCallback((from: HTMLElement) => {
    trigger.current = from;
    app.ui.setSheetOpen(true);
  }, []);
  const onSelect = useCallback(
    (flagId: string | null, from: HTMLElement) => {
      app.ui.selectFlag(flagId);
      // Below 1024 px, selecting a flag with a clause opens the document at it.
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
  return { onSelect, onFind, onRerun: input === null ? undefined : onRerun, returnFocus };
}
