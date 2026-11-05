import type { Flag, Lang } from "@clauseclear/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../../i18n/useT";
import { displayText, segmentNumber } from "../../lib/document";
import { visibleFlags } from "../../lib/flags";
import type { Filter } from "../../state/ui";
import { GlossaryText, type GlossaryNote } from "../GlossaryText";
import { FoundTick } from "../landing/FoundTick";
import { ReadAloud } from "../ReadAloud";
import { Stamp } from "../motifs/Stamp";

const FILTERS: {
  value: Filter;
  label: "results.filterAll" | "results.filterHigh" | "results.filterMedium";
}[] = [
  { value: "all", label: "results.filterAll" },
  { value: "high", label: "results.filterHigh" },
  { value: "medium", label: "results.filterMedium" },
];

export interface FlagNotes {
  /** Terms as they read in the page language, matched in the explanations. */
  text: readonly GlossaryNote[];
  /** English terms, matched in the quote, which always stays English. */
  quote: readonly GlossaryNote[];
}

interface FlagListProps {
  flags: readonly Flag[];
  numbers: ReadonlyMap<string, number>;
  filter: Filter;
  selectedFlagId: string | null;
  notesFor: (flag: Flag) => FlagNotes;
  dynamicLang: string | undefined;
  /** The language the explanations are in right now, for read aloud. */
  speechLang: Lang;
  onFilter: (filter: Filter) => void;
  /** The pressed flag header comes along, so the sheet can return focus to it. */
  onSelect: (flagId: string | null, trigger: HTMLElement) => void;
  /** Below 1024 px: "Find it in the document" opens the sheet at the flag's clause. */
  onFind?: ((flagId: string, trigger: HTMLElement) => void) | undefined;
  /** Below 640 px the list starts with this many flags and a "See N more flags" button. */
  initialCount?: number | undefined;
}

/** "Marked up, worst first" (SPEC F7, F9, F10): filter buttons and one open flag at a time. */
export function FlagList({
  flags,
  numbers,
  filter,
  selectedFlagId,
  notesFor,
  dynamicLang,
  speechLang,
  onFilter,
  onSelect,
  onFind,
  initialCount,
}: FlagListProps) {
  const t = useT();
  const all = visibleFlags(flags, filter);
  // "See more" holds per filter, so a new filter starts short again.
  const [expandedFor, setExpandedFor] = useState<Filter | null>(null);
  const selectedIndex = all.findIndex((flag) => flag.id === selectedFlagId);
  const limit =
    initialCount === undefined || expandedFor === filter || selectedIndex >= initialCount
      ? all.length
      : initialCount;
  const shown = all.slice(0, limit);
  const hidden = all.length - shown.length;
  // After "See more", focus moves to the first flag it revealed, since the button is gone.
  const focusNext = useRef<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (focusNext.current === null) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-flag-id="${focusNext.current}"] .cc-flag__head`)
      ?.focus();
    focusNext.current = null;
  });

  return (
    <section className="cc-flags" aria-labelledby="flags-heading">
      <div className="cc-flags__head">
        <h2 id="flags-heading" className="cc-results__h2">
          {t("results.flagsHeading")}
        </h2>
        {flags.length > 0 && (
          <div className="cc-filter" role="group" aria-label={t("results.filterLabel")}>
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="cc-filter__button"
                aria-pressed={filter === option.value}
                onClick={() => {
                  onFilter(option.value);
                }}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        )}
      </div>

      {flags.length === 0 ? (
        <p className="cc-flags__empty">{t("results.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="cc-flags__empty" role="status">
          {t("results.noFlagsAtLevel")}
        </p>
      ) : (
        <>
          <ol ref={list} className="cc-flag-list" lang={dynamicLang}>
            {shown.map((flag) => (
              <FlagRow
                key={flag.id}
                flag={flag}
                n={numbers.get(flag.id) ?? 0}
                open={flag.id === selectedFlagId}
                notes={notesFor(flag)}
                speechLang={speechLang}
                onToggle={(trigger) => {
                  onSelect(flag.id === selectedFlagId ? null : flag.id, trigger);
                }}
                onFind={onFind}
              />
            ))}
          </ol>
          {hidden > 0 && (
            <button
              type="button"
              className="cc-button cc-button--secondary cc-flags__more"
              onClick={() => {
                focusNext.current = all[limit]?.id ?? null;
                setExpandedFor(filter);
              }}
            >
              {t("results.moreFlags", { n: hidden })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function FlagRow({
  flag,
  n,
  open,
  notes,
  speechLang,
  onToggle,
  onFind,
}: {
  flag: Flag;
  n: number;
  open: boolean;
  notes: FlagNotes;
  speechLang: Lang;
  onToggle: (trigger: HTMLElement) => void;
  onFind: ((flagId: string, trigger: HTMLElement) => void) | undefined;
}) {
  const t = useT();
  const bodyId = useId();
  const tone = flag.kind === "missing" ? "missing" : flag.severity;

  return (
    <li className={`cc-flag cc-flag--${tone}`} data-flag-id={flag.id} data-open={open}>
      <h3 className="cc-flag__heading">
        <button
          type="button"
          className="cc-flag__head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={(event) => {
            onToggle(event.currentTarget);
          }}
        >
          <span className="cc-flag__number">{n}</span>
          <span className="cc-flag__label">
            <Stamp severity={tone} />
            <span className={open ? "cc-flag__title cc-marker" : "cc-flag__title"}>
              {flag.title}
            </span>
          </span>
          <span className="cc-flag__sign" aria-hidden="true">
            {open ? "–" : "+"}
          </span>
        </button>
      </h3>
      <div id={bodyId} className="cc-flag__body" hidden={!open}>
        <GlossaryText className="cc-flag__plain" text={flag.plain} terms={notes.text} />
        <p className="cc-flag__why-label">{t("results.whyHeading")}</p>
        <GlossaryText className="cc-flag__why" text={flag.why} terms={notes.text} />
        {/* Mounted only while open, so closing the flag stops its reading. */}
        {open && (
          <ReadAloud
            id={`flag:${flag.id}`}
            text={`${flag.title}. ${flag.plain} ${flag.why}`}
            lang={speechLang}
            label={t("results.listenFlag")}
          />
        )}
        {flag.kind === "present" && flag.quote !== undefined && flag.segmentId !== undefined ? (
          <figure className="cc-quote">
            <figcaption className="cc-quote__caption">
              {t("results.where", { n: segmentNumber(flag.segmentId) })}
            </figcaption>
            <blockquote className="cc-quote__text" lang="en">
              <GlossaryText
                as="span"
                className="cc-marker"
                text={displayText(flag.quote)}
                terms={notes.quote}
              />
            </blockquote>
            <p className="cc-found">
              <FoundTick />
              {t("common.foundInDoc")}
            </p>
          </figure>
        ) : (
          <p className="cc-missing-box">{t("results.docMissing", { item: flag.category })}</p>
        )}
        {flag.kind === "present" && onFind !== undefined && (
          <button
            type="button"
            className="cc-button cc-button--primary cc-flag__find"
            onClick={(event) => {
              onFind(flag.id, event.currentTarget);
            }}
          >
            {t("results.showInDoc")}
          </button>
        )}
      </div>
    </li>
  );
}
