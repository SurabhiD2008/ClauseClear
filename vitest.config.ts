import { defineConfig } from "vitest/config";

// Each workspace with tests has its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ["*/vitest.config.ts"],
  },
});
