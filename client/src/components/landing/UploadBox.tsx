import { MAX_FILE_MB, SLOW_NOTICE_MS, type StatusEvent } from "@clauseclear/shared";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useT } from "../../i18n/useT";
import { settleGuard } from "../../lib/clicks";
import { progressIndex } from "../../lib/progress";
import { LoadingView } from "./LoadingView";

interface UploadBoxProps {
  active: boolean;
  runId: number | null;
  progress: StatusEvent | null;
  onFile: (file: File) => void;
  onPaste: () => void;
  onCancel: () => void;
  /**
   * The error that ended the last run, drawn as the box's third view in place of
   * the idle one. It gets "Choose a PDF", so the idle view's
   * two actions stay on offer; the strip itself always offers Paste text.
   */
  renderError?: ((choosePdf: () => void) => ReactNode) | undefined;
  errorRef?: Ref<HTMLDivElement>;
  /**
   * Hidden copies of every error view, laid out in the same cell so the box is
   * always as tall as its tallest error at this width and in this language, and
   * an error never grows it.
   */
  errorSizers?: readonly { key: string; node: ReactNode }[];
}

/**
 * While a run is active: focus on Cancel, a guard against a doubled key press,
 * and the slow-server line after SLOW_NOTICE_MS.
 */
function useLoadingState(active: boolean, runId: number | null) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [cancelGuard] = useState(() => settleGuard());
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
  return { cancelButton, cancelGuard, slow };
}

/** Drag and drop anywhere on the box; ignored while a run is active. */
function useDropZone(active: boolean, onFile: (file: File) => void) {
  const [dragging, setDragging] = useState(false);
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
  return { dragging, dragProps };
}

/** The idle view: the drop target, "Choose a PDF", "Paste text" and the hidden file input. */
function IdleView({
  idle,
  dragging,
  inputRef,
  choosePdf,
  onPaste,
  onFile,
}: {
  idle: boolean;
  dragging: boolean;
  inputRef: RefObject<HTMLInputElement>;
  choosePdf: () => void;
  onPaste: () => void;
  onFile: (file: File) => void;
}) {
  const t = useT();
  return (
    <div className="cc-upload__body cc-upload__layer" data-off={!idle} aria-hidden={!idle}>
      <div className="cc-upload__lead">
        <svg className="cc-upload__glyph" viewBox="0 0 54 66" aria-hidden="true" focusable="false">
          <path className="cc-upload__glyph-page" d="M2 2 H38 L52 16 V64 H2 Z" />
          <path className="cc-upload__glyph-page" d="M38 2 V16 H52" />
          <path className="cc-upload__glyph-mark" d="M11 38 H43" />
          <path className="cc-upload__glyph-line" d="M11 27 H34 M11 38 H43 M11 49 H43" />
        </svg>
        <div>
          <p className="cc-upload__title">
            {dragging ? t("landing.dropActive") : t("landing.uploadTitle")}
          </p>
          <p className="cc-upload__meta">{t("landing.uploadMeta", { mb: MAX_FILE_MB })}</p>
        </div>
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
        ref={inputRef}
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
  );
}

/**
 * Hidden copies of every error view keep the box as tall as its tallest error;
 * the error that ended the last run is shown on top of them.
 */
function ErrorLayers({
  sizers,
  view,
  errorRef,
}: {
  sizers: readonly { key: string; node: ReactNode }[];
  view: ReactNode;
  errorRef: Ref<HTMLDivElement> | undefined;
}) {
  return (
    <>
      {sizers.map(({ key, node }) => (
        <div key={key} className="cc-upload__layer" data-off="true" aria-hidden="true">
          {node}
        </div>
      ))}
      {view !== null && (
        <div ref={errorRef} tabIndex={-1} className="cc-upload__layer cc-hero__error">
          {view}
        </div>
      )}
    </>
  );
}

/**
 * The upload box: drag-and-drop anywhere on the box, a
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
  const { cancelButton, cancelGuard, slow } = useLoadingState(active, runId);
  const { dragging, dragProps } = useDropZone(active, onFile);
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
          page (no layout shift). */}
      <div className="cc-upload__stack">
        <LoadingView
          active={active}
          current={current}
          slow={slow}
          cancelRef={cancelButton}
          onCancelClick={(detail) => {
            // Keyboard activations have detail 0; a mouse click is always deliberate here.
            if (detail === 0 && !cancelGuard.ready()) return;
            onCancel();
          }}
        />
        <IdleView
          idle={idle}
          dragging={dragging}
          inputRef={input}
          choosePdf={choosePdf}
          onPaste={onPaste}
          onFile={onFile}
        />
        <ErrorLayers sizers={errorSizers} view={errorView} errorRef={errorRef} />
      </div>
    </div>
  );
}
