// One error enum for server and client (SPEC section 7). Each code has its HTTP
// status, the i18n key the UI uses for its friendly message, and a short English
// message the server sends in the error body.

import { MAX_FILE_MB, MAX_PDF_PAGES, MAX_TEXT_CHARS, MIN_TEXT_CHARS } from "./constants.js";

const fmt = (n: number) => n.toLocaleString("en-US");

export const ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "NOT_PDF",
  "PDF_ENCRYPTED",
  "TOO_MANY_PAGES",
  "NO_TEXT",
  "TEXT_TOO_SHORT",
  "TEXT_TOO_LONG",
  "NOT_LEGAL",
  "NOT_ENGLISH",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "ANALYSIS_FAILED",
  "CANCELLED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDefinition {
  status: number;
  messageKey: `errors.${ErrorCode}`;
  message: string;
}

export const ERROR_DEFINITIONS: Record<ErrorCode, ErrorDefinition> = {
  BAD_REQUEST: {
    status: 400,
    messageKey: "errors.BAD_REQUEST",
    message: "Send a PDF file or some text.",
  },
  NOT_FOUND: { status: 404, messageKey: "errors.NOT_FOUND", message: "Not found." },
  FILE_TOO_LARGE: {
    status: 413,
    messageKey: "errors.FILE_TOO_LARGE",
    message: `The file is over ${fmt(MAX_FILE_MB)} MB.`,
  },
  NOT_PDF: { status: 415, messageKey: "errors.NOT_PDF", message: "The file is not a PDF." },
  PDF_ENCRYPTED: {
    status: 422,
    messageKey: "errors.PDF_ENCRYPTED",
    message: "The PDF is password-protected.",
  },
  TOO_MANY_PAGES: {
    status: 422,
    messageKey: "errors.TOO_MANY_PAGES",
    message: `The PDF has more than ${fmt(MAX_PDF_PAGES)} pages.`,
  },
  NO_TEXT: {
    status: 422,
    messageKey: "errors.NO_TEXT",
    message: "The PDF has no readable text. It may be a scan.",
  },
  TEXT_TOO_SHORT: {
    status: 422,
    messageKey: "errors.TEXT_TOO_SHORT",
    message: `The text is under ${fmt(MIN_TEXT_CHARS)} characters.`,
  },
  TEXT_TOO_LONG: {
    status: 422,
    messageKey: "errors.TEXT_TOO_LONG",
    message: `The text is over ${fmt(MAX_TEXT_CHARS)} characters.`,
  },
  NOT_LEGAL: {
    status: 422,
    messageKey: "errors.NOT_LEGAL",
    message: "This does not look like a legal document.",
  },
  NOT_ENGLISH: {
    status: 422,
    messageKey: "errors.NOT_ENGLISH",
    message: "The document must be in English.",
  },
  RATE_LIMITED: {
    status: 429,
    messageKey: "errors.RATE_LIMITED",
    message: "Too many requests. Try again later or open a sample.",
  },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    messageKey: "errors.PROVIDER_UNAVAILABLE",
    message: "The AI service is unavailable.",
  },
  ANALYSIS_FAILED: {
    status: 500,
    messageKey: "errors.ANALYSIS_FAILED",
    message: "The analysis could not be completed.",
  },
  CANCELLED: {
    status: 499,
    messageKey: "errors.CANCELLED",
    message: "The analysis was cancelled.",
  },
};

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  retryAfterSec?: number;
}

/** The one error body shape, used for HTTP error responses and SSE error events. */
export function errorBody(code: ErrorCode, extra: { retryAfterSec?: number } = {}): ErrorBody {
  const body: ErrorBody = { code, message: ERROR_DEFINITIONS[code].message };
  if (extra.retryAfterSec !== undefined) body.retryAfterSec = extra.retryAfterSec;
  return body;
}
