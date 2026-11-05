import type { ErrorBody } from "@clauseclear/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/useT";
import { DEFAULT_RETRY_AFTER_SEC, ERROR_NEXT_STEPS, errorMessage } from "../lib/errors";

interface ErrorStripProps {
  error: ErrorBody;
  /** Runs the same input again; the button shows only when the code allows a retry. */
  onRetry?: () => void;
  /** Opens the paste dialog. Paste text is always offered (SPEC F19). */
  onPaste?: () => void;
  /** Opens the file picker; offered where the error replaces the upload box (prompt 18). */
  onChoose?: () => void;
  /**
   * A hidden copy that only reserves space in the upload box (prompt 18): no
   * role, so it is never announced, and no countdown timer.
   */
  sizer?: boolean;
}

/**
 * One error: a red stamp, the friendly message for its code, and its next step.
 * Built from the dashed strip pattern (design.md section 8).
 */
export function ErrorStrip({ error, onRetry, onPaste, onChoose, sizer = false }: ErrorStripProps) {
  const t = useT();
  const next = ERROR_NEXT_STEPS[error.code];
  const { key, vars } = errorMessage(error);
  const wait = error.code === "RATE_LIMITED" ? (error.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC) : 0;
  const [left, setLeft] = useState(wait);

  useEffect(() => {
    setLeft(wait);
    if (wait === 0 || sizer) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const remaining = Math.max(0, wait - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(timer);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [error, wait, sizer]);

  const showRetry = next.retry && onRetry !== undefined;

  return (
    <div className="cc-error" {...(sizer ? {} : { role: "alert", "data-error-code": error.code })}>
      <span className="cc-stamp cc-stamp--high">{t("errorUi.stamp")}</span>
      <p className="cc-error__message">{t(key, vars)}</p>
      <div className="cc-error__actions">
        {showRetry && (
          <button
            type="button"
            className="cc-button cc-button--primary"
            disabled={left > 0}
            onClick={onRetry}
          >
            {left > 0 ? t("errorUi.retryIn", { n: left }) : t("errorUi.retry")}
          </button>
        )}
        {onPaste !== undefined && (
          <button
            type="button"
            className={`cc-button ${showRetry ? "cc-button--secondary" : "cc-button--primary"}`}
            onClick={onPaste}
          >
            {t("errorUi.pasteInstead")}
          </button>
        )}
        {onChoose !== undefined && (
          <button type="button" className="cc-button cc-button--secondary" onClick={onChoose}>
            {t("landing.choosePdf")}
          </button>
        )}
        {next.sample && (
          <Link className="cc-text-link" to="/#samples">
            {t("errorUi.trySample")}
          </Link>
        )}
      </div>
    </div>
  );
}
