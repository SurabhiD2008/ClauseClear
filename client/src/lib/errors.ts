// Every error code's friendly message and next step (SPEC section 3 F19, section 9
// "Errors"). The message is errors.<CODE> in en.json and hi.json; paste text is
// always offered as the fallback, and these add the code's own next step.
import {
  MAX_FILE_MB,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  type ErrorBody,
  type ErrorCode,
} from "@clauseclear/shared";
import type { MessageKey, MessageVars } from "../i18n/messages";

export interface ErrorNextStep {
  /** Run the same input again (a server or provider problem, or a cancelled run). */
  retry: boolean;
  /** Offer a sample, which costs no AI call. */
  sample: boolean;
}

export const ERROR_NEXT_STEPS: Record<ErrorCode, ErrorNextStep> = {
  BAD_REQUEST: { retry: false, sample: false },
  NOT_FOUND: { retry: false, sample: true },
  FILE_TOO_LARGE: { retry: false, sample: false },
  NOT_PDF: { retry: false, sample: false },
  PDF_ENCRYPTED: { retry: false, sample: false },
  TOO_MANY_PAGES: { retry: false, sample: false },
  NO_TEXT: { retry: false, sample: false },
  TEXT_TOO_SHORT: { retry: false, sample: false },
  TEXT_TOO_LONG: { retry: false, sample: false },
  NOT_LEGAL: { retry: false, sample: true },
  NOT_ENGLISH: { retry: false, sample: false },
  RATE_LIMITED: { retry: true, sample: true },
  PROVIDER_UNAVAILABLE: { retry: true, sample: true },
  ANALYSIS_FAILED: { retry: true, sample: false },
  CANCELLED: { retry: true, sample: false },
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** RATE_LIMITED always carries retryAfterSec from the server; a minute is the fallback (A86). */
export const DEFAULT_RETRY_AFTER_SEC = 60;

export function errorMessage(error: ErrorBody): { key: MessageKey; vars: MessageVars } {
  return {
    key: `errors.${error.code}`,
    vars: {
      mb: fmt(MAX_FILE_MB),
      pages: fmt(MAX_PDF_PAGES),
      min: fmt(MIN_TEXT_CHARS),
      max: fmt(MAX_TEXT_CHARS),
      n: error.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC,
    },
  };
}
