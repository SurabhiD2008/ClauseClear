// The configuration schema: every environment variable the app or its tooling
// reads, with its default and meaning. `.env.example` and the README tables list
// exactly these names, and `npm run verify` checks that the three agree.
import { DEFAULT_PORT, ENV_DEFAULTS } from "@clauseclear/shared";

export interface ConfigVariable {
  name: string;
  /** The value used when the variable is unset, as text; "" when there is none. */
  default: string;
  /** The value `.env.example` suggests, when it differs from the default. */
  example?: string;
  description: string;
  /** "app" variables configure a running server; "tooling" ones only tests and scripts. */
  scope: "app" | "tooling";
}

const d = (n: number) => String(n);

export const CONFIG_VARIABLES: readonly ConfigVariable[] = [
  {
    name: "LLM_PROVIDER_ORDER",
    default: "gemini,nvidia",
    description: "Providers tried in order; `mock` for a demo or tests",
    scope: "app",
  },
  {
    name: "GEMINI_API_KEY",
    default: "",
    description: "Gemini key from Google AI Studio (server only)",
    scope: "app",
  },
  {
    name: "GEMINI_MODEL",
    default: "",
    description: "Gemini model ID from AI Studio",
    scope: "app",
  },
  {
    name: "GEMINI_THINKING_LEVEL",
    default: "",
    example: "LOW",
    description: "Gemini 3 and later: `MINIMAL`, `LOW`, `MEDIUM` or `HIGH`; empty for Gemini 2.x",
    scope: "app",
  },
  {
    name: "GEMINI_RPM",
    default: d(ENV_DEFAULTS.GEMINI_RPM),
    description: "Gemini requests per minute",
    scope: "app",
  },
  {
    name: "GEMINI_RPD_BUDGET",
    default: d(ENV_DEFAULTS.GEMINI_RPD_BUDGET),
    description: "Gemini requests per day before falling back",
    scope: "app",
  },
  {
    name: "GEMINI_BASE_URL",
    default: ENV_DEFAULTS.GEMINI_BASE_URL,
    description: "Change only if Google moves the API version",
    scope: "app",
  },
  {
    name: "NVIDIA_API_KEY",
    default: "",
    description: "NVIDIA key from build.nvidia.com (server only)",
    scope: "app",
  },
  { name: "NVIDIA_MODEL", default: "", description: "NVIDIA instruct model ID", scope: "app" },
  {
    name: "NVIDIA_BASE_URL",
    default: ENV_DEFAULTS.NVIDIA_BASE_URL,
    description: "NVIDIA's OpenAI-compatible endpoint",
    scope: "app",
  },
  {
    name: "NVIDIA_RPM",
    default: d(ENV_DEFAULTS.NVIDIA_RPM),
    description: "NVIDIA requests per minute",
    scope: "app",
  },
  {
    name: "NVIDIA_RPD_BUDGET",
    default: d(ENV_DEFAULTS.NVIDIA_RPD_BUDGET),
    description: "NVIDIA requests per day before falling back",
    scope: "app",
  },
  {
    name: "NVIDIA_MAX_OUTPUT_TOKENS",
    default: "",
    example: "3072",
    description: "Largest answer NVIDIA is asked for (no cap when unset); larger jobs are split",
    scope: "app",
  },
  {
    name: "MAX_INPUT_TOKENS",
    default: d(ENV_DEFAULTS.MAX_INPUT_TOKENS),
    description: "Largest input per call (characters / 4); longer documents are read in parts",
    scope: "app",
  },
  {
    name: "LLM_CONCURRENCY",
    default: d(ENV_DEFAULTS.LLM_CONCURRENCY),
    description: "AI calls in flight across the whole server",
    scope: "app",
  },
  {
    name: "LLM_TIMEOUT_MS",
    default: d(ENV_DEFAULTS.LLM_TIMEOUT_MS),
    description: "Time limit per AI call",
    scope: "app",
  },
  {
    name: "ANALYSIS_BUDGET_MS",
    default: d(ENV_DEFAULTS.ANALYSIS_BUDGET_MS),
    description: "Time limit for one whole analysis",
    scope: "app",
  },
  {
    name: "IP_ANALYSES_PER_10_MIN",
    default: d(ENV_DEFAULTS.IP_ANALYSES_PER_10_MIN),
    description: "Analyses per visitor (IP address) per 10 minutes",
    scope: "app",
  },
  {
    name: "GLOBAL_ANALYSES_PER_DAY",
    default: d(ENV_DEFAULTS.GLOBAL_ANALYSES_PER_DAY),
    description: "Analyses across the whole server per day",
    scope: "app",
  },
  {
    name: "GLOBAL_TRANSLATIONS_PER_DAY",
    default: d(ENV_DEFAULTS.GLOBAL_TRANSLATIONS_PER_DAY),
    description: "Hindi translations across the whole server per day",
    scope: "app",
  },
  {
    name: "TRUST_PROXY",
    default: "0",
    description:
      "Proxy hops whose `X-Forwarded-For` is trusted for the per-IP limit (`1` on Vercel and Render)",
    scope: "app",
  },
  {
    name: "PORT",
    default: d(DEFAULT_PORT),
    description: "Port the server listens on (hosts set it)",
    scope: "app",
  },
  {
    name: "NODE_ENV",
    default: "production",
    description: "`npm start` sets `production`, which serves the built client; tests use `test`",
    scope: "app",
  },
  {
    name: "SMOKE_URL",
    default: `http://localhost:${d(DEFAULT_PORT)}`,
    description: "Default URL for `npm run smoke`",
    scope: "app",
  },
  {
    name: "MOCK_SCENARIO",
    default: "normal",
    description: "Which made-up answer the mock gives (tests)",
    scope: "app",
  },
  {
    name: "MOCK_SLOW_MS",
    default: d(ENV_DEFAULTS.MOCK_SLOW_MS),
    description: "How long the mock's `slow` scenario waits",
    scope: "tooling",
  },
  {
    name: "MOCK_RPM",
    default: d(ENV_DEFAULTS.MOCK_RPM),
    description: "Mock requests per minute",
    scope: "tooling",
  },
  {
    name: "MOCK_RPD_BUDGET",
    default: d(ENV_DEFAULTS.MOCK_RPD_BUDGET),
    description: "Mock requests per day",
    scope: "tooling",
  },
  {
    name: "E2E_GUARD_PAGES",
    default: "",
    description:
      "`1` serves the browser guard's self-test pages at `/__guard/` (end-to-end tests only)",
    scope: "tooling",
  },
  {
    name: "E2E_SKIP_BUILD",
    default: "",
    description: "`1` makes the end-to-end suite reuse an existing build",
    scope: "tooling",
  },
  {
    name: "SCREENSHOT_URL",
    default: "",
    description: "Take the README screenshots from this running server instead of starting one",
    scope: "tooling",
  },
  {
    name: "SCREENSHOT_DEBUG",
    default: "",
    description: "`1` prints the screenshot script's browser console",
    scope: "tooling",
  },
  {
    name: "MEASURE_URL",
    default: "http://127.0.0.1:4173",
    description: "Server that `npm run measure:layout` measures",
    scope: "tooling",
  },
  {
    name: "CI",
    default: "",
    description: "Set by CI services; fails the browser suite on a focused test",
    scope: "tooling",
  },
];

/** The default of one variable, for scripts that need the same fallback as the docs. */
export function configDefault(name: string): string {
  const variable = CONFIG_VARIABLES.find((v) => v.name === name);
  if (variable === undefined) throw new Error(`${name} is not in the configuration schema`);
  return variable.default;
}
