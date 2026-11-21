import type { Flag, Lang } from "@clauseclear/shared";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "../../i18n/useT";
import { visibleFlags } from "../../lib/flags";
import type { Filter } from "../../state/ui";
import type { GlossaryNote } from "../GlossaryText";
import { FlagRow } from "./FlagRow";

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

/**
 * Below 640 px the list starts short, with "See N more flags"; the choice holds per
 * filter. After "See more", focus moves to the first flag it revealed.
 */
function useSeeMore(
  all: readonly Flag[],
  filter: Filter,
  selectedFlagId: string | null,
  initialCount: number | undefined,
) {
  const [expandedFor, setExpandedFor] = useState<Filter | null>(null);
  const selectedIndex = all.findIndex((flag) => flag.id === selectedFlagId);
  const limit =
    initialCount === undefined || expandedFor === filter || selectedIndex >= initialCount
      ? all.length
      : initialCount;
  const focusNext = useRef<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (focusNext.current === null) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-flag-id="${focusNext.current}"] .cc-flag__head`)
      ?.focus();
    focusNext.current = null;
  });
  const revealMore = () => {
    focusNext.current = all[limit]?.id ?? null;
    setExpandedFor(filter);
  };
  return {
    shown: all.slice(0, limit),
    hidden: all.length - Math.min(limit, all.length),
    list,
    revealMore,
  };
}

function FilterButtons({
  filter,
  onFilter,
}: {
  filter: Filter;
  onFilter: (filter: Filter) => void;
}) {
  const t = useT();
  return (
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
  );
}

/** The open list of flags and, when it is cut short, the "See N more flags" button. */
function FlagItems({
  numbers,
  selectedFlagId,
  notesFor,
  dynamicLang,
  speechLang,
  onSelect,
  onFind,
  shown,
  hidden,
  listRef,
  revealMore,
}: FlagListProps & {
  shown: readonly Flag[];
  hidden: number;
  listRef: RefObject<HTMLOListElement>;
  revealMore: () => void;
}) {
  const t = useT();
  return (
    <>
      <ol ref={listRef} className="cc-flag-list" lang={dynamicLang}>
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
          onClick={revealMore}
        >
          {t("results.moreFlags", { n: hidden })}
        </button>
      )}
    </>
  );
}

/** "Marked up, worst first": filter buttons and one open flag at a time. */
export function FlagList(props: FlagListProps) {
  const { flags, filter, selectedFlagId } = props;
  const t = useT();
  const all = visibleFlags(flags, filter);
  const { shown, hidden, list, revealMore } = useSeeMore(
    all,
    filter,
    selectedFlagId,
    props.initialCount,
  );
  return (
    <section className="cc-flags" aria-labelledby="flags-heading">
      <div className="cc-flags__head">
        <h2 id="flags-heading" className="cc-results__h2">
          {t("results.flagsHeading")}
        </h2>
        {flags.length > 0 && <FilterButtons filter={filter} onFilter={props.onFilter} />}
      </div>
      {flags.length === 0 ? (
        <p className="cc-flags__empty">{t("results.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="cc-flags__empty" role="status">
          {t("results.noFlagsAtLevel")}
        </p>
      ) : (
        <FlagItems
          {...props}
          shown={shown}
          hidden={hidden}
          listRef={list}
          revealMore={revealMore}
        />
      )}
    </section>
  );
}
