import { defineConfig } from "vitest/config";

// Unit tests only: pure modules and stores, no DOM. Rendering is covered by Playwright.
export default defineConfig({
  test: {
    name: "client",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A test that asserts nothing fails, so every test proves something.
    expect: { requireAssertions: true },
  },
});
