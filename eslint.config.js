import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "playwright-report", "test-results"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // "error", not "warn". Lesson from a sibling project: the worst feature-loss bugs all
      // surfaced as a function nobody calls (a button never wired to its handler). At "warn"
      // level CI stays green and the half-finished feature ships anyway.
      // To keep an unused binding on purpose, prefix it with `_` or eslint-disable with a reason.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // shadcn-ui primitives are vendored code and are not hand-edited (see CLAUDE.md).
    // Relax only the rules its generated code trips, instead of editing the primitives.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Playwright runs on Node with its own idioms: the `async ({}, use)` fixture trips
    // no-empty-pattern, and the `use(...)` callback is NOT a React hook.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-empty-pattern": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    // Node scripts (seeding, guide sync) — they run outside the app bundle.
    // `.mts` needs the TypeScript parser named explicitly: the shared config above only
    // attaches it to `**/*.{ts,tsx}`, so without this the default JS parser chokes on a
    // type annotation and reports "Unexpected token :".
    files: ["scripts/**/*.{ts,mts,mjs,js}"],
    languageOptions: { parser: tseslint.parser, globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
