import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "test-results/**",
      "playwright-report/**",
      "blob-report/**",
      "audit/**",
    ],
  },
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Functions stay short enough to review in one sitting. Test files are
    // and fixture data are exempt: describe blocks group cases, fixtures hold data.
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["**/*.test.ts", "client/e2e/**", "**/testing/**", "shared/src/fixtures/**"],
    rules: {
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
