import { defineConfig } from "@playwright/test";

const port = 4173;

// Mock-only env every test server shares. The abuse limits are raised because
// every project shares one client IP.
const MOCK_ENV = {
  NODE_ENV: "production",
  LLM_PROVIDER_ORDER: "mock",
  MOCK_SCENARIO: "slow",
  MOCK_SLOW_MS: "1500",
  IP_ANALYSES_PER_10_MIN: "1000",
  GLOBAL_ANALYSES_PER_DAY: "100000",
};

/**
 * Extra servers for the provider-failure and limit flows (prompt 17, A158). Each
 * has its own router, so a 429, an open circuit breaker or a spent IP allowance
 * there can never reach a test on the main server. They start after the main
 * server, which builds first (Playwright sets web servers up one at a time).
 */
export const SCENARIO_SERVERS = {
  /** The first provider always answers 429; the second answers slowly. */
  fallback: 4174,
  /** Every provider answers 429. */
  rateLimited: 4175,
  /** Every provider answers HTTP 500. */
  unavailable: 4176,
  /** Real limits: 6 analyses per IP, 2 LLM calls at once. */
  limits: 4177,
} as const;

const scenarioServer = (serverPort: number, env: Record<string, string>) => ({
  command: "npm run start",
  url: `http://127.0.0.1:${String(serverPort)}/api/health`,
  env: { ...MOCK_ENV, PORT: String(serverPort), ...env },
  reuseExistingServer: false,
  timeout: 60_000,
});

// The five viewport projects from SPEC section 12. E2E runs against the
// production build, so it also proves the server serves client/dist.
export default defineConfig({
  testDir: "client/e2e",
  fullyParallel: true,
  // The guard runs axe after every test, which is CPU-bound; 3 of 4 cores.
  workers: 3,
  forbidOnly: process.env.CI !== undefined,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    browserName: "chromium",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1360, height: 900 } } },
    { name: "laptop", use: { viewport: { width: 1024, height: 768 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: "small-phone",
      use: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      // npm run audit builds once and sets E2E_SKIP_BUILD so the build is not repeated.
      command:
        process.env.E2E_SKIP_BUILD === "1" ? "npm run start" : "npm run build && npm run start",
      url: `http://127.0.0.1:${String(port)}/api/health`,
      // The mock provider only: e2e never calls a real model. "slow" holds each
      // analysis for MOCK_SLOW_MS (abortable), long enough to cancel mid-run.
      env: {
        ...MOCK_ENV,
        PORT: String(port),
        // Serves client/e2e/guard-pages at /__guard/ for the guard self-tests.
        E2E_GUARD_PAGES: "1",
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    scenarioServer(SCENARIO_SERVERS.fallback, {
      LLM_PROVIDER_ORDER: "mock,mock2",
      MOCK_SCENARIO: "rate_limit",
      MOCK2_SCENARIO: "slow",
      // Long enough to see the 20 s notice with the browser clock moved on.
      MOCK2_SLOW_MS: "5000",
    }),
    scenarioServer(SCENARIO_SERVERS.rateLimited, {
      LLM_PROVIDER_ORDER: "mock,mock2",
      MOCK_SCENARIO: "rate_limit",
      MOCK2_SCENARIO: "rate_limit",
    }),
    scenarioServer(SCENARIO_SERVERS.unavailable, {
      LLM_PROVIDER_ORDER: "mock,mock2",
      MOCK_SCENARIO: "server_error",
      MOCK2_SCENARIO: "server_error",
      // Once both breakers are open (60 s), a shorter budget than that ends the
      // call at once instead of waiting for them to close.
      ANALYSIS_BUDGET_MS: "30000",
    }),
    scenarioServer(SCENARIO_SERVERS.limits, {
      MOCK_SLOW_MS: "1000",
      IP_ANALYSES_PER_10_MIN: "6",
      LLM_CONCURRENCY: "2",
    }),
  ],
});
