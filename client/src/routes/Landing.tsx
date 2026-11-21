import { ERROR_CODES, ERROR_DEFINITIONS, isRunActive, type ErrorBody } from "@clauseclear/shared";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { ErrorStrip } from "../components/ErrorStrip";
import { HeroSheet } from "../components/landing/HeroSheet";
import { UploadBox } from "../components/landing/UploadBox";
import { RedPenCircle } from "../components/motifs/RedPenCircle";
import { PasteDialog } from "../components/PasteDialog";
import { useT } from "../i18n/useT";
import type { AnalyzeInput } from "../lib/api";
import { ERROR_NEXT_STEPS } from "../lib/errors";
import { useAnalysis } from "../state/hooks";
import { app } from "../state/instance";
import {
  ExtrasSection,
  FeedSection,
  HowSection,
  SampleLinks,
  SmallPrintSection,
} from "./landingSections";

const noop = () => undefined;

/**
 * One hidden copy of every error view that can end a run (a cancel shows under
 * the box instead), with the same buttons, so the upload box reserves the
 * tallest one.
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

type Analysis = ReturnType<typeof useAnalysis>;

/**
 * Only a run that finishes while this page is open moves to the result; coming
 * back here after an earlier result must not bounce the user forward again.
 * A run started on the results page ("Not right? Change it") arrives here with
 * its id, so it is followed even though it began before this page mounted. A
 * run that ends in an error or a cancel moves focus to the message, since the
 * Cancel button that had focus is gone.
 */
function useFollowRun(analysis: Analysis, location: Location, errorRef: RefObject<HTMLDivElement>) {
  const navigate = useNavigate();
  const { status, runId } = analysis.run.machine;
  const followRun = (location.state as { followRun?: number } | null)?.followRun;
  const runIdAtMount = useRef(followRun === runId ? -1 : runId);
  const { current } = analysis;
  useEffect(() => {
    if (status === "done" && current?.source === "run" && runId !== runIdAtMount.current) {
      void navigate("/results");
    }
  }, [status, runId, current, navigate]);
  useEffect(() => {
    if ((status === "error" || status === "cancelled") && runId !== runIdAtMount.current) {
      errorRef.current?.focus();
    }
  }, [status, runId]);
}

/** In-page links (/#how-it-works, /#privacy, /#samples) from any page. */
function useHashScroll(location: Location): void {
  useEffect(() => {
    if (location.hash === "") return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.hash, location.key]);
}

/**
 * A file dropped outside the upload box would make the browser open it and
 * leave the page; only the box accepts drops.
 */
function useBlockStrayDrops(): void {
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
}

interface HeroProps {
  analysis: Analysis;
  note: string | undefined;
  shownError: ErrorBody | null;
  errorRef: RefObject<HTMLDivElement>;
  /** Runs the last input again; null before the first run. */
  onRetry: (() => void) | null;
  onFile: (file: File) => void;
  onPaste: () => void;
}

/** The error strip's actions: Try again (when there is an input to retry) and Paste text. */
const stripActions = (onRetry: (() => void) | null, onPaste: () => void) => ({
  ...(onRetry === null ? {} : { onRetry }),
  onPaste,
});

function HeroUpload({
  analysis,
  shownError,
  errorRef,
  onRetry,
  onFile,
  onPaste,
}: Omit<HeroProps, "note">) {
  const active = isRunActive(analysis.run.machine.status);
  return (
    <>
      <UploadBox
        active={active}
        runId={analysis.run.machine.runId}
        progress={analysis.run.progress}
        onFile={onFile}
        onPaste={onPaste}
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
                  {...stripActions(onRetry, onPaste)}
                  onChoose={choosePdf}
                />
              )
        }
      />
      {/* A cancel is the user's own click, so its note can sit under the idle box
        (the page may move within 500 ms of input). */}
      {shownError?.code === "CANCELLED" && !active && (
        <div ref={errorRef} tabIndex={-1} className="cc-hero__error">
          <ErrorStrip error={shownError} {...stripActions(onRetry, onPaste)} />
        </div>
      )}
    </>
  );
}

function Hero(props: HeroProps) {
  const t = useT();
  return (
    <section className="cc-hero-band cc-night" aria-labelledby="hero-title">
      <div className="cc-page cc-hero">
        <div className="cc-hero__main">
          <p className="cc-kicker">{t("landing.kicker")}</p>
          <h1 id="hero-title" className="cc-hero__title">
            {t("landing.h1Before")}
            <RedPenCircle>{t("landing.h1Circled")}</RedPenCircle>
            {t("landing.h1After")}
          </h1>
          <p className="cc-hero__intro">{t("landing.intro")}</p>
          {props.note === "resultGone" && (
            <p className="cc-hero__note" role="status">
              {t("landing.resultGone")}
            </p>
          )}
          <HeroUpload {...props} />
          <p className="cc-hero__small">{t("landing.privacyNotice")}</p>
          <p className="cc-hero__small cc-hero__small--muted">{t("landing.scope")}</p>
          <SampleLinks />
        </div>
        <HeroSheet />
      </div>
    </section>
  );
}

/** The error that ended the last run, or a cancel note; null otherwise. */
function errorShown(analysis: Analysis): ErrorBody | null {
  const { status } = analysis.run.machine;
  if (status === "error" && analysis.error !== null) return analysis.error;
  return status === "cancelled" ? { code: "CANCELLED", message: "" } : null;
}

/** The landing page. */
export function Landing() {
  const location = useLocation();
  const analysis = useAnalysis();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const lastInput = useRef<AnalyzeInput | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useFollowRun(analysis, location, errorRef);
  useHashScroll(location);
  useBlockStrayDrops();

  const start = (input: AnalyzeInput) => {
    lastInput.current = input;
    void app.analysis.start(input);
  };
  const shownError = errorShown(analysis);
  const retry = lastInput.current;
  const openPaste = () => {
    setPasteOpen(true);
  };

  return (
    <div className="cc-landing">
      <Hero
        analysis={analysis}
        note={(location.state as { note?: string } | null)?.note}
        shownError={shownError}
        errorRef={errorRef}
        onRetry={
          retry === null
            ? null
            : () => {
                start(retry);
              }
        }
        onFile={(file) => {
          start({ kind: "file", file, name: file.name });
        }}
        onPaste={openPaste}
      />
      <FeedSection />
      <HowSection />
      <ExtrasSection />
      <SmallPrintSection />
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
