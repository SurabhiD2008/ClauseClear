import { ERROR_CODES, ERROR_DEFINITIONS, isRunActive } from "@clauseclear/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ErrorStrip } from "../components/ErrorStrip";
import { GlossaryParagraph } from "../components/GlossaryTerm";
import { HeroSheet } from "../components/landing/HeroSheet";
import { UploadBox } from "../components/landing/UploadBox";
import { Marker } from "../components/motifs/Marker";
import { RedPenCircle } from "../components/motifs/RedPenCircle";
import { RuledSheet } from "../components/motifs/RuledSheet";
import { SectionMark } from "../components/motifs/SectionMark";
import { PasteDialog } from "../components/PasteDialog";
import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/useT";
import type { AnalyzeInput } from "../lib/api";
import { isFollowUpClick } from "../lib/clicks";
import { ERROR_NEXT_STEPS } from "../lib/errors";
import { useAnalysis } from "../state/hooks";
import { app } from "../state/instance";

const SAMPLES = [
  { id: "rental", label: "landing.sampleRental" },
  { id: "job-offer", label: "landing.sampleJob" },
  { id: "loan", label: "landing.sampleLoan" },
] as const;

/** The sample whose checklist the §3 teaser opens. */
const TEASER_SAMPLE = "rental";

const FEED: MessageKey[] = [
  "landing.feed1",
  "landing.feed2",
  "landing.feed3",
  "landing.feed4",
  "landing.feed5",
  "landing.feed6",
];

const STEPS = [
  { n: "01", title: "landing.step1Title", text: "landing.step1Text" },
  { n: "02", title: "landing.step2Title", text: "landing.step2Text" },
  { n: "03", title: "landing.step3Title", text: "landing.step3Text" },
] as const;

const CHECK_ITEMS = ["landing.checkItem1", "landing.checkItem2", "landing.checkItem3"] as const;

const CLAUSES = [
  { n: "4.1", text: "landing.clause41" },
  { n: "4.2", text: "landing.clause42" },
  { n: "4.3", text: "landing.clause43" },
  { n: "4.4", text: "landing.clause44" },
] as const;

/** Landing (design/landing.png, SPEC sections 9 and 10). */
const noop = () => undefined;

/**
 * One hidden copy of every error view that can end a run (a cancel shows under
 * the box instead), with the same buttons, so the upload box reserves the
 * tallest one (prompt 18, A164).
 */
const errorSizers = ERROR_CODES.filter((code) => code !== "CANCELLED").map((code) => ({
  key: code,
  node: (
    <ErrorStrip
      sizer
      error={{ code, message: ERROR_DEFINITIONS[code].message }}
      {...(ERROR_NEXT_STEPS[code].retry ? { onRetry: noop } : {})}
      onPaste={noop}
      onChoose={noop}
    />
  ),
}));

export function Landing() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { run, error, current } = useAnalysis();
  const { status, runId } = run.machine;
  const active = isRunActive(status);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const lastInput = useRef<AnalyzeInput | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const start = (input: AnalyzeInput) => {
    lastInput.current = input;
    void app.analysis.start(input);
  };

  // Only a run that finishes while this page is open moves to the result; coming
  // back here after an earlier result must not bounce the user forward again.
  // A run started on the results page ("Not right? Change it") arrives here with
  // its id, so it is followed even though it began before this page mounted.
  const followRun = (location.state as { followRun?: number } | null)?.followRun;
  const runIdAtMount = useRef(followRun === runId ? -1 : runId);
  useEffect(() => {
    if (status === "done" && current?.source === "run" && runId !== runIdAtMount.current) {
      void navigate("/results");
    }
  }, [status, runId, current, navigate]);

  // A run that ends in an error or a cancel moves focus to the message, since the
  // Cancel button that had focus is gone.
  useEffect(() => {
    if ((status === "error" || status === "cancelled") && runId !== runIdAtMount.current) {
      errorRef.current?.focus();
    }
  }, [status, runId]);

  // In-page links (/#how-it-works, /#privacy, /#samples) from any page.
  useEffect(() => {
    if (location.hash === "") return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.hash, location.key]);

  // A file dropped outside the upload box would make the browser open it and
  // leave the page; only the box accepts drops.
  useEffect(() => {
    const block = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const note = (location.state as { note?: string } | null)?.note;
  const shownError =
    status === "error" && error !== null
      ? error
      : status === "cancelled"
        ? { code: "CANCELLED" as const, message: "" }
        : null;
  const retry = lastInput.current;

  return (
    <div className="cc-landing">
      <section className="cc-page cc-hero" aria-labelledby="hero-title">
        <div className="cc-hero__main">
          <p className="cc-kicker">{t("landing.kicker")}</p>
          <h1 id="hero-title" className="cc-hero__title">
            {t("landing.h1Before")}
            <RedPenCircle>{t("landing.h1Circled")}</RedPenCircle>
            {t("landing.h1After")}
          </h1>
          <p className="cc-hero__intro">{t("landing.intro")}</p>

          {note === "resultGone" && (
            <p className="cc-hero__note" role="status">
              {t("landing.resultGone")}
            </p>
          )}

          <UploadBox
            active={active}
            runId={runId}
            progress={run.progress}
            onFile={(file) => {
              start({ kind: "file", file, name: file.name });
            }}
            onPaste={() => {
              setPasteOpen(true);
            }}
            onCancel={() => {
              app.analysis.cancel();
            }}
            errorRef={errorRef}
            errorSizers={errorSizers}
            renderError={
              shownError === null || shownError.code === "CANCELLED"
                ? undefined
                : (choosePdf) => (
                    <ErrorStrip
                      error={shownError}
                      {...(retry === null
                        ? {}
                        : {
                            onRetry: () => {
                              start(retry);
                            },
                          })}
                      onPaste={() => {
                        setPasteOpen(true);
                      }}
                      onChoose={choosePdf}
                    />
                  )
            }
          />

          {/* A cancel is the user's own click, so its note can sit under the idle box
              (the page may move within 500 ms of input). */}
          {shownError?.code === "CANCELLED" && !active && (
            <div ref={errorRef} tabIndex={-1} className="cc-hero__error">
              <ErrorStrip
                error={shownError}
                {...(retry === null
                  ? {}
                  : {
                      onRetry: () => {
                        start(retry);
                      },
                    })}
                onPaste={() => {
                  setPasteOpen(true);
                }}
              />
            </div>
          )}

          <p className="cc-hero__small">{t("landing.privacyNotice")}</p>
          <p className="cc-hero__small cc-hero__small--muted">{t("landing.scope")}</p>
          <p className="cc-samples" id="samples">
            <span>{t("landing.tryLabel")}</span>
            {SAMPLES.map((sample) => (
              <Link
                key={sample.id}
                className="cc-text-link"
                to={`/results/sample/${sample.id}`}
                onClick={(event) => {
                  if (isFollowUpClick(event)) {
                    event.preventDefault();
                    return;
                  }
                  void app.analysis.openSample(sample.id, { fresh: true });
                }}
              >
                {t(sample.label)}
              </Link>
            ))}
          </p>
        </div>
        <HeroSheet />
      </section>

      <section className="cc-band" aria-labelledby="feed">
        <div className="cc-page cc-band__grid">
          <SectionMark n={1} id="feed">
            {t("landing.feedLabel")}
          </SectionMark>
          <div>
            <ul className="cc-feed">
              {FEED.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
              <li>
                {t("landing.feedLastBefore")}
                <Marker>{t("landing.feedLastHighlight")}</Marker>
                {t("landing.feedLastAfter")}
              </li>
            </ul>
            <p className="cc-band__note">{t("landing.feedNote")}</p>
          </div>
        </div>
      </section>

      <section className="cc-band" id="how-it-works" aria-labelledby="how">
        <div className="cc-page cc-band__grid">
          <SectionMark n={2} id="how">
            {t("landing.howLabel")}
          </SectionMark>
          <ol className="cc-ledger">
            {STEPS.map((step) => (
              <li key={step.n} className="cc-ledger__row">
                <span className="cc-ledger__n" aria-hidden="true">
                  {step.n}
                </span>
                <div>
                  <h3 className="cc-ledger__title">{t(step.title)}</h3>
                  <p className="cc-ledger__text">{t(step.text)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="cc-band" aria-labelledby="extras">
        <div className="cc-page cc-band__grid">
          <SectionMark n={3} id="extras">
            {t("landing.extrasLabel")}
          </SectionMark>
          <div className="cc-extras">
            <div className="cc-extras__item">
              <h3 className="cc-extras__title">{t("landing.checkTitle")}</h3>
              <p className="cc-extras__text">{t("landing.checkText")}</p>
              <RuledSheet className="cc-extras__sheet">
                <ul>
                  {CHECK_ITEMS.map((key) => (
                    <li key={key} className="cc-teaser-item">
                      <svg
                        className="cc-teaser-item__box"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M3 3.5 L 17 2.8 L 16.6 17 L 3.4 17.4 Z" />
                      </svg>
                      {t(key)}
                    </li>
                  ))}
                </ul>
              </RuledSheet>
              <Link
                className="cc-mono-link"
                to="/checklist"
                onClick={(event) => {
                  if (isFollowUpClick(event)) {
                    event.preventDefault();
                    return;
                  }
                  void app.analysis.openSample(TEASER_SAMPLE, { fresh: false });
                }}
              >
                {t("landing.checkLink")}
              </Link>
            </div>
            <div className="cc-extras__item">
              <h3 className="cc-extras__title">{t("landing.glossTitle")}</h3>
              <p className="cc-extras__text">{t("landing.glossText")}</p>
              <div className="cc-gloss">
                <p className="cc-gloss__label">{t("landing.glossDoc")}</p>
                <GlossaryParagraph
                  lang="en"
                  before={t("landing.glossClauseBefore")}
                  term={t("landing.glossTerm")}
                  after={t("landing.glossClauseAfter")}
                  title={t("landing.glossTipTitle")}
                  definition={t("landing.glossTipDef")}
                  defaultOpen
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="cc-band" id="privacy" aria-labelledby="small-print">
        <div className="cc-page cc-band__grid">
          <SectionMark n={4} id="small-print">
            {t("landing.smallPrintLabel")}
          </SectionMark>
          <ol className="cc-contract">
            {CLAUSES.map((clause) => (
              <li key={clause.n} className="cc-contract__clause">
                <span className="cc-contract__n">{clause.n}</span>
                <span>{t(clause.text)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <PasteDialog
        open={pasteOpen}
        text={pasteText}
        onTextChange={setPasteText}
        onClose={() => {
          setPasteOpen(false);
        }}
        onSubmit={(text) => {
          setPasteOpen(false);
          start({ kind: "text", text });
        }}
      />
    </div>
  );
}
