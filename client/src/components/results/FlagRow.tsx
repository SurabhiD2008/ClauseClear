import type { Flag, Lang } from "@clauseclear/shared";
import { useId } from "react";
import { useT } from "../../i18n/useT";
import { displayText, segmentNumber } from "../../lib/document";
import { GlossaryText } from "../GlossaryText";
import { FoundTick } from "../landing/FoundTick";
import { ReadAloud } from "../ReadAloud";
import { Stamp } from "../motifs/Stamp";
import type { FlagNotes } from "./FlagList";

/** The quote strip with "Found in your document", or the box saying what is missing. */
function FlagEvidence({ flag, notes }: { flag: Flag; notes: FlagNotes }) {
  const t = useT();
  if (flag.kind === "present" && flag.quote !== undefined && flag.segmentId !== undefined) {
    return (
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
    );
  }
  return <p className="cc-missing-box">{t("results.docMissing", { item: flag.category })}</p>;
}

function FlagHead({
  flag,
  n,
  open,
  bodyId,
  onToggle,
}: {
  flag: Flag;
  n: number;
  open: boolean;
  bodyId: string;
  onToggle: (trigger: HTMLElement) => void;
}) {
  const tone = flag.kind === "missing" ? "missing" : flag.severity;
  return (
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
          <span className={open ? "cc-flag__title cc-marker" : "cc-flag__title"}>{flag.title}</span>
        </span>
        <span className="cc-flag__sign" aria-hidden="true">
          {open ? "–" : "+"}
        </span>
      </button>
    </h3>
  );
}

export function FlagRow({
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
      <FlagHead flag={flag} n={n} open={open} bodyId={bodyId} onToggle={onToggle} />
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
        <FlagEvidence flag={flag} notes={notes} />
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
