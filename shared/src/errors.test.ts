import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_DEFINITIONS, errorBody, type ErrorCode } from "./errors.js";
import { errorEventSchema } from "./schemas.js";

// SPEC section 7 table, plus NOT_ENGLISH (ASSUMPTIONS A11) and NOT_FOUND (A30).
const EXPECTED_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  FILE_TOO_LARGE: 413,
  NOT_PDF: 415,
  PDF_ENCRYPTED: 422,
  TOO_MANY_PAGES: 422,
  NO_TEXT: 422,
  TEXT_TOO_SHORT: 422,
  TEXT_TOO_LONG: 422,
  NOT_LEGAL: 422,
  NOT_ENGLISH: 422,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  ANALYSIS_FAILED: 500,
  CANCELLED: 499,
};

describe("ErrorCode completeness", () => {
  it("has exactly the expected codes", () => {
    expect([...ERROR_CODES].sort()).toEqual(Object.keys(EXPECTED_STATUS).sort());
  });

  it("defines every code and nothing else", () => {
    expect(Object.keys(ERROR_DEFINITIONS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it.each(Object.entries(EXPECTED_STATUS))("%s maps to HTTP %i", (code, status) => {
    expect(ERROR_DEFINITIONS[code as ErrorCode].status).toBe(status);
  });

  it.each(ERROR_CODES.map((code) => ({ code })))(
    "$code has its message key and a message",
    ({ code }) => {
      const def = ERROR_DEFINITIONS[code];
      expect(def.messageKey).toBe(`errors.${code}`);
      expect(def.message.length).toBeGreaterThan(0);
    },
  );

  it("builds an error body that the error event schema accepts", () => {
    for (const code of ERROR_CODES) {
      expect(errorEventSchema.safeParse(errorBody(code)).success).toBe(true);
    }
    expect(errorBody("RATE_LIMITED", { retryAfterSec: 42 })).toEqual({
      code: "RATE_LIMITED",
      message: ERROR_DEFINITIONS.RATE_LIMITED.message,
      retryAfterSec: 42,
    });
  });
});
