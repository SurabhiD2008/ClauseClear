// Every limit and threshold in ClauseClear. Nothing else in the repo may hard-code
// these numbers (SPEC section 13, rule 2). Section references are to SPEC.md.

// --- Server ---
/** Port when PORT is unset. client/vite.config.ts repeats it for the dev proxy (ASSUMPTIONS A31). */
export const DEFAULT_PORT = 3000;

// --- Intake (section 2, section 6 step 1) ---
export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_PDF_PAGES = 25;
export const PDF_MAGIC = "%PDF";
/** Applies to pasted text and to text extracted from a PDF (ASSUMPTIONS A12). */
export const MIN_TEXT_CHARS = 200;
export const MAX_TEXT_CHARS = 60_000;
/** Extracted text below this means a scan with no text layer (section 6 step 2). */
export const NO_TEXT_MIN_CHARS = 200;
export const PDF_PARSE_TIMEOUT_MS = 20_000;
/** PDFs parsed at once, each in its own worker thread; the rest wait (A175). */
export const PDF_PARSE_CONCURRENCY = 2;
/**
 * Non-space characters a PDF worker may read before it stops with TEXT_TOO_LONG.
 * Normalising never adds half again, so a PDF over this is over MAX_TEXT_CHARS;
 * stopping early keeps a page of 300,000 tiny runs out of the main thread (A175).
 */
export const PDF_RAW_CHARS_LIMIT = Math.ceil(MAX_TEXT_CHARS * 1.5);
/** V8 heap cap for one PDF worker; a PDF that needs more is NOT_PDF (A175). */
export const PDF_WORKER_HEAP_MB = 512;

// --- Segmenting and type detection (section 6 steps 4 and 5) ---
export const SEGMENT_MAX_CHARS = 900;
export const TYPE_CONFIDENT_MIN_SCORE = 6;
export const TYPE_CONFIDENT_RATIO = 2;
export const TYPE_DETECT_SAMPLE_TOKENS = 3_000;

// --- Tokens and chunking (section 5 call budget, section 6 step 7) ---
export const CHARS_PER_TOKEN = 4;
export const CHUNK_TARGET_TOKENS = 12_000;
export const CHUNK_CONCURRENCY = 2;
export const TRANSLATE_BATCH_TOKENS = 8_000;
/** Largest /api/translate request, in estimated tokens: 3 batches, the top of section 5's 1 to 3 calls (A99). */
export const TRANSLATE_MAX_REQUEST_TOKENS = 3 * TRANSLATE_BATCH_TOKENS;

// --- Model output caps per call (section 6 steps 5 and 7; ASSUMPTIONS A74, A92) ---
// Thinking models count reasoning tokens toward these caps, so they leave room for it.
export const DOC_TYPE_MAX_OUTPUT_TOKENS = 1_024;
export const ANALYSIS_MAX_OUTPUT_TOKENS = 16_384;
export const CHUNK_MAX_OUTPUT_TOKENS = 12_288;
export const SYNTHESIS_MAX_OUTPUT_TOKENS = 8_192;
/** One translation batch; Devanagari takes more tokens than the English it replaces (A99). */
export const TRANSLATE_MAX_OUTPUT_TOKENS = 16_384;
/**
 * Output tokens to expect per document token, for sizing parts for a provider
 * with an output cap (A95). Measured about 3.3 on the live fixtures (A94).
 */
export const CAPPED_OUTPUT_PER_INPUT_TOKEN = 4;

// --- Verification (section 6 step 8) ---
export const QUOTE_FUZZY_MIN_SIMILARITY = 0.9;
/** More than this share of flags failing verification triggers one stricter retry. */
export const VERIFY_RETRY_FAIL_RATIO = 0.5;
export const SCHEMA_REPAIR_RETRIES = 1;
export const TRANSLATION_RETRIES = 1;

// --- LLM router (section 5 rules 2 to 5) ---
export const BACKOFF_STEPS_MS = [2_000, 4_000, 8_000] as const;
export const BACKOFF_JITTER_RATIO = 0.25;
export const CIRCUIT_BREAKER_FAILURES = 3;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
/** Gemini daily quotas reset at midnight Pacific; every provider's daily counter uses the same day. */
export const DAILY_QUOTA_TIME_ZONE = "America/Los_Angeles";

// --- Rate limits ---
export const IP_WINDOW_MS = 10 * 60 * 1000;

/** Defaults for the environment variables in section 5, deliberately below the free limits. */
export const ENV_DEFAULTS = {
  GEMINI_RPM: 8,
  GEMINI_RPD_BUDGET: 200,
  NVIDIA_RPM: 20,
  NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1",
  // Not in SPEC section 5 (ASSUMPTIONS A55): every provider gets a daily counter.
  NVIDIA_RPD_BUDGET: 200,
  GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
  OPENAI_COMPAT_RPM: 10,
  OPENAI_COMPAT_RPD_BUDGET: 200,
  MOCK_RPM: 600,
  MOCK_RPD_BUDGET: 100_000,
  MOCK_SLOW_MS: 5_000,
  MAX_INPUT_TOKENS: 24_000,
  LLM_CONCURRENCY: 2,
  LLM_TIMEOUT_MS: 45_000,
  ANALYSIS_BUDGET_MS: 100_000,
  IP_ANALYSES_PER_10_MIN: 6,
  GLOBAL_ANALYSES_PER_DAY: 60,
} as const;

// --- Result content (sections 3 and 7) ---
export const TITLE_MAX_CHARS = 120;
export const EXPLANATION_MAX_CHARS = 600;
export const SUMMARY_MIN_SENTENCES = 2;
export const SUMMARY_MAX_SENTENCES = 4;
export const MIN_KEY_FACTS = 4;
export const MAX_KEY_FACTS = 8;
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 8;
export const MAX_GLOSSARY_TERMS = 12;

// --- Scoring (section 6) ---
export const SCORE_WEIGHTS = {
  highFlag: 18,
  mediumFlag: 8,
  highMissing: 10,
  mediumMissing: 5,
} as const;
export const SCORE_MAX = 100;
/** Scores below this are "low". */
export const SCORE_BAND_MEDIUM_FROM = 25;
/** Scores at or above this are "high". */
export const SCORE_BAND_HIGH_FROM = 55;

// --- Client behaviour (section 9) and audit (section 12) ---
export const SLOW_NOTICE_MS = 20_000;
/** sessionStorage key prefix for checklist ticks; the analysis id follows. Holds item ids only. */
export const TICKS_STORAGE_PREFIX = "cc.ticks.";
export const MIN_TOUCH_TARGET_PX = 44;
export const MAX_LAYOUT_SHIFT = 0.1;
export const BUNDLE_BUDGET_GZIP_BYTES = 250 * 1024;
export const LIVE_TEST_MAX_CALLS = 6;
/** npm run samples: 3 analyses, then 1 to 2 translation calls each (A98). */
export const SAMPLES_BUILD_MAX_CALLS = 12;
