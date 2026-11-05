import { MAX_FILE_MB, SLOW_NOTICE_MS, type StatusEvent } from "@clauseclear/shared";
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { useT } from "../../i18n/useT";
import { settleGuard } from "../../lib/clicks";
import { PROGRESS_LABELS, progressIndex } from "../../lib/progress";

interface UploadBoxProps {
  active: boolean;
  runId: number | null;
  progress: StatusEvent | null;
  onFile: (file: File) => void;
  onPaste: () => void;
  onCancel: () => void;
  /**
   * The error that ended the last run, drawn as the box's third view in place of
   * the idle one (prompt 18, A164). It gets "Choose a PDF", so the idle view's
   * two actions stay on offer; the strip itself always offers Paste text.
   */
  renderError?: ((choosePdf: () => void) => ReactNode) | undefined;
  errorRef?: Ref<HTMLDivElement>;
  /**
   * Hidden copies of every error view, laid out in the same cell so the box is
   * always as tall as its tallest error at this width and in this language, and
   * an error never grows it (prompt 18, A164).
   */
  errorSizers?: readonly { key: string; node: ReactNode }[];
}

/**
 * The upload box (design.md section 4): drag-and-drop anywhere on the box, a
 * "Choose a PDF" button for the file picker, and "Paste text". While a run is
 * active it shows the loading view instead: the step list from the server's
 * status events, Cancel, and after 20 seconds the slow-server line.
 */
export function UploadBox({
  active,
  runId,
  progress,
  onFile,
  onPaste,
  onCancel,
  renderError,
  errorRef,
  errorSizers = [],
}: UploadBoxProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [cancelGuard] = useState(() => settleGuard());
  const [dragging, setDragging] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setSlow(false);
    if (!active) return;
    // Keyboard users land on Cancel, the only control that works during a run.
    cancelButton.current?.focus();
    // A doubled key press on the control that started the run must not cancel it.
    cancelGuard.arm();
    const timer = setTimeout(() => {
      setSlow(true);
    }, SLOW_NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [active, runId, cancelGuard]);

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const dragProps = {
    onDragEnter: (event: DragEvent) => {
      if (active || !hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (active || !hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      // Leaving for a child element is not leaving the box.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (!active && file !== undefined) onFile(file);
    },
  };

  const current = progressIndex(progress?.step);
  const choosePdf = () => input.current?.click();
  const errorView = active || renderError === undefined ? null : renderError(choosePdf);
  const idle = !active && errorView === null;

  return (
    <div
      className="cc-upload"
      data-dragging={dragging ? "true" : undefined}
      role="region"
      aria-label={t("landing.uploadLegend")}
      {...dragProps}
    >
      <span className="cc-upload__legend" aria-hidden="true">
        {t("landing.uploadLegend")}
      </span>

      {/* The views are laid out in the same grid cell and the ones not in use are
          hidden, so the box keeps the tallest one's height: starting a run,
          finishing it, the 20 s line and an error that ends the run never move the
          page (no layout shift; prompt 18 moved run errors in here). */}
      <div className="cc-upload__stack">
        <div className="cc-loading cc-upload__layer" data-off={!active} aria-hidden={!active}>
          <p className="cc-upload__title">{t("landing.loadingTitle")}</p>
          <ol className="cc-loading__steps" aria-label={t("landing.progressLabel")}>
            {PROGRESS_LABELS.map((label, index) => {
              const state = index < current ? "done" : index === current ? "now" : "next";
              return (
                <li
                  key={label}
                  className="cc-loading__step"
                  data-state={state}
                  aria-current={state === "now" ? "step" : undefined}
                >
                  <span className="cc-loading__mark" aria-hidden="true">
                    {state === "done" ? <Tick /> : null}
                  </span>
                  {t(label)}
                  {state !== "next" && (
                    <span className="cc-visually-hidden">
                      {" "}
                      ({t(state === "done" ? "landing.stepDone" : "landing.stepNow")})
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {active && (
            <p className="cc-visually-hidden" role="status">
              {t(PROGRESS_LABELS[current] ?? "landing.stepReading")}
            </p>
          )}
          {/* The line's space is kept from the start; its text shows after 20 s. */}
          <p className="cc-loading__slow" role="status">
            <span data-shown={active && slow}>{t("landing.slow")}</span>
          </p>
          <div className="cc-upload__actions">
            <button
              ref={cancelButton}
              type="button"
              className="cc-button cc-button--secondary"
              onClick={(event) => {
                // Keyboard activations have detail 0; a mouse click is always deliberate here.
                if (event.detail === 0 && !cancelGuard.ready()) return;
                onCancel();
              }}
            >
              {t("landing.cancel")}
            </button>
          </div>
        </div>
        <div className="cc-upload__body cc-upload__layer" data-off={!idle} aria-hidden={!idle}>
          <div>
            <p className="cc-upload__title">
              {dragging ? t("landing.dropActive") : t("landing.uploadTitle")}
            </p>
            <p className="cc-upload__meta">{t("landing.uploadMeta", { mb: MAX_FILE_MB })}</p>
          </div>
          <div className="cc-upload__actions">
            <button type="button" className="cc-button cc-button--primary" onClick={choosePdf}>
              {t("landing.choosePdf")}
            </button>
            <button type="button" className="cc-button cc-button--secondary" onClick={onPaste}>
              {t("landing.pasteText")}
            </button>
          </div>
          {/* The real file input, opened by "Choose a PDF"; out of the tab order so
              keyboard focus never lands on something invisible. */}
          <input
            ref={input}
            className="cc-visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) onFile(file);
            }}
          />
        </div>
        {errorSizers.map(({ key, node }) => (
          <div key={key} className="cc-upload__layer" data-off="true" aria-hidden="true">
            {node}
          </div>
        ))}
        {errorView !== null && (
          <div ref={errorRef} tabIndex={-1} className="cc-upload__layer cc-hero__error">
            {errorView}
          </div>
        )}
      </div>
    </div>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
      <path d="M2 9 L6 13 L14 3" />
    </svg>
  );
}
