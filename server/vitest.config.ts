import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A test that asserts nothing fails, so every test proves something.
    expect: { requireAssertions: true },
  },
});
