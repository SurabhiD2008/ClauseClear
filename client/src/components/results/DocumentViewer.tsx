import type { AnalysisResult, Flag, Segment } from "@clauseclear/shared";
import { Fragment, useEffect, useRef } from "react";
import { useT } from "../../i18n/useT";
import { displayText, segmentParts, splitTerms, termHits } from "../../lib/document";
import { useGlossary, type GlossaryNote } from "../GlossaryText";

interface DocumentViewerProps {
  result: AnalysisResult;
  numbers: ReadonlyMap<string, number>;
  selectedFlagId: string | null;
  /** Glossary terms in English (the document's language), notes in the page language. */
  notes: readonly GlossaryNote[];
  /** The sheet has its own header, so it hides this bar. */
  bar?: boolean;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The user's document as segmented (SPEC F8, design.md section 4). Flagged
 * clauses carry their flag-number circles; the selected flag's quote is wrapped
 * in a <mark>. Selecting a flag scrolls this panel, not the page, to its clause.
 * Everything inside is the user's own text, so it is lang="en".
 */
export function DocumentViewer({
  result,
  numbers,
  selectedFlagId,
  notes,
  bar = true,
}: DocumentViewerProps) {
  const t = useT();
  const body = useRef<HTMLDivElement>(null);
  const selected = result.flags.find((flag) => flag.id === selectedFlagId);
  const targetSegment = selected?.kind === "present" ? selected.segmentId : undefined;

  useEffect(() => {
    const panel = body.current;
    if (panel === null || targetSegment === undefined) return;
    const clause = panel.querySelector<HTMLElement>(`[data-segment-id="${targetSegment}"]`);
    if (clause === null) return;
    panel.scrollTo({
      top: Math.max(0, clause.offsetTop - 16),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [targetSegment, selectedFlagId]);

  return (
    <div className="cc-doc">
      {bar && (
        <div className="cc-doc__bar">
          <h2 className="cc-doc__heading">{t("results.docHeading")}</h2>
          <p className="cc-doc__hint">{t("results.docHint")}</p>
        </div>
      )}
      {/* A scrolling region must be reachable by keyboard to scroll it. */}
      <div
        ref={body}
        className="cc-doc__body"
        tabIndex={0}
        role="region"
        aria-label={t("results.docHeading")}
        lang="en"
        data-testid="document-viewer"
      >
        {result.segments.map((segment) => (
          <SegmentBlock
            key={segment.id}
            segment={segment}
            flags={result.flags}
            numbers={numbers}
            selectedFlagId={selectedFlagId}
            notes={notes}
          />
        ))}
      </div>
    </div>
  );
}

interface SegmentBlockProps {
  segment: Segment;
  flags: readonly Flag[];
  numbers: ReadonlyMap<string, number>;
  selectedFlagId: string | null;
  notes: readonly GlossaryNote[];
}

/** One clause: its flag circles, its text with quotes and glossary terms, and the open note. */
function SegmentBlock({ segment, flags, numbers, selectedFlagId, notes }: SegmentBlockProps) {
  const t = useT();
  const glossary = useGlossary();
  const parts = segmentParts(segment, flags);
  const flagged = parts.filter((part) => part.flagId !== undefined);
  // Each term is marked once per clause, wherever the quotes split the text.
  const hits = termHits(segment.text, notes);
  const offsets = parts.map((_, i) => parts.slice(0, i).reduce((n, p) => n + p.text.length, 0));
  const used = notes.filter((note) => hits.some((hit) => hit.term.id === note.id));
  const pieces = (text: string, offset: number) =>
    splitTerms(displayText(text), offset, hits).map((piece, j) =>
      piece.term === undefined ? (
        <Fragment key={j}>{piece.text}</Fragment>
      ) : (
        glossary.term(piece.term, piece.text, j)
      ),
    );
  return (
    <div
      ref={glossary.root}
      className="cc-doc__segment cc-gloss-text"
      data-segment-id={segment.id}
      data-selected={flagged.some((part) => part.flagId === selectedFlagId)}
    >
      <span className="cc-doc__circles">
        {flagged.map((part) => {
          const flag = flags.find((f) => f.id === part.flagId);
          if (flag === undefined) return null;
          const n = numbers.get(flag.id) ?? 0;
          return (
            <span
              key={flag.id}
              className={`cc-doc__circle cc-doc__circle--${flag.severity}`}
              role="img"
              aria-label={t("results.flagCircle", {
                n,
                severity: t(`common.severity.${flag.severity}`),
              })}
            >
              {n}
            </span>
          );
        })}
      </span>
      <p className="cc-doc__text">
        {parts.map((part, i) =>
          part.flagId === undefined ? (
            <Fragment key={i}>{pieces(part.text, offsets[i] ?? 0)}</Fragment>
          ) : part.flagId === selectedFlagId ? (
            <mark key={i} className="cc-marker" data-flag-id={part.flagId}>
              {pieces(part.text, offsets[i] ?? 0)}
            </mark>
          ) : (
            <span key={i} className="cc-doc__flagged" data-flag-id={part.flagId}>
              {pieces(part.text, offsets[i] ?? 0)}
            </span>
          ),
        )}
      </p>
      {glossary.tips(used)}
    </div>
  );
}
