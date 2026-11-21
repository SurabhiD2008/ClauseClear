import { defineConfig } from "vitest/config";
import { COVERAGE_THRESHOLD } from "./vitest.thresholds.js";

// Each workspace with tests has its own vitest.config.ts. Coverage is measured on
// the server and shared code; the client's pure modules are covered too, but the
// floor applies to the layers that hold the rules.
export default defineConfig({
  test: {
    projects: ["*/vitest.config.ts"],
    coverage: {
      provider: "v8",
      include: ["server/src/**/*.ts", "shared/src/**/*.ts", "client/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/testing/**", "**/fixtures/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        "server/src/**": { lines: COVERAGE_THRESHOLD },
        "shared/src/**": { lines: COVERAGE_THRESHOLD },
      },
    },
  },
});
