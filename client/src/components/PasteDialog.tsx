import { MAX_TEXT_CHARS, MIN_TEXT_CHARS, type ErrorBody } from "@clauseclear/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { swallowFollowUpClicks } from "../lib/clicks";
import { errorMessage } from "../lib/errors";
import { validateInput } from "../state/analysis";

const fmt = (n: number) => n.toLocaleString("en-US");

interface PasteDialogProps {
  open: boolean;
  /** Kept between openings, so a retry after an error starts from the same text. */
  text: string;
  onTextChange: (text: string) => void;
  onClose: () => void;
  /** Called only with text that passed the client checks; the server checks again. */
  onSubmit: (text: string) => void;
}

/**
 * The paste-text dialog (SPEC F2): a native modal <dialog>, so focus stays inside
 * while it is open, Esc closes it and focus returns to the button that opened it.
 */
export function PasteDialog({ open, text, onTextChange, onClose, onSubmit }: PasteDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const hintId = useId();
  const [problem, setProblem] = useState<ErrorBody | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setProblem(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const length = text.trim().length;
  const counterState =
    length === 0 ? "" : length < MIN_TEXT_CHARS || length > MAX_TEXT_CHARS ? "out" : "ok";

  const submit = async () => {
    const invalid = await validateInput({ kind: "text", text });
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }
    // Close before the run starts: closing restores focus to the opener, and that
    // must happen before the loading view moves focus to Cancel, not after.
    ref.current?.close();
    // A double-click's second click must not reach what was under the dialog.
    swallowFollowUpClicks();
    onSubmit(text);
  };

  return (
    <dialog
      ref={ref}
      className="cc-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <form
        method="dialog"
        className="cc-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <span className="cc-upload__legend" aria-hidden="true">
          {t("landing.uploadLegend")}
        </span>
        <h2 id={titleId} className="cc-dialog__title">
          {t("landing.pasteTitle")}
        </h2>
        <label htmlFor={fieldId} className="cc-dialog__label">
          {t("landing.pasteLabel")}
        </label>
        <p id={hintId} className="cc-dialog__hint">
          {t("landing.pasteHint", { min: fmt(MIN_TEXT_CHARS), max: fmt(MAX_TEXT_CHARS) })}
        </p>
        <textarea
          id={fieldId}
          className="cc-dialog__field"
          lang="en"
          value={text}
          aria-describedby={hintId}
          onChange={(event) => {
            onTextChange(event.target.value);
            setProblem(null);
          }}
        />
        <p className="cc-dialog__counter" data-state={counterState} aria-live="polite">
          {t("landing.charCount", { n: fmt(length), max: fmt(MAX_TEXT_CHARS) })}
        </p>
        {problem !== null && (
          <p className="cc-dialog__problem" role="alert" data-error-code={problem.code}>
            {t(errorMessage(problem).key, errorMessage(problem).vars)}
          </p>
        )}
        <div className="cc-dialog__actions">
          <button type="submit" className="cc-button cc-button--primary">
            {t("landing.analyzeText")}
          </button>
          <button type="button" className="cc-button cc-button--secondary" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
