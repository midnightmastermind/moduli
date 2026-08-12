// Minimal ESLint flat config — SCOPED to dead-code hygiene only.
// It intentionally does NOT enable the full react/hooks rule sets; its single
// job is finding (and auto-removing) unused imports, plus reporting unused
// locals for manual review. Run: `npm run lint` (report) / `npm run lint:fix`
// (auto-remove unused imports).
//
// CRITICAL: `react/jsx-uses-vars` MUST be enabled — without it, eslint does not
// count `<Component/>` JSX references as USING the `Component` import, so an
// autofix would strip every JSX-only component import and gut the bundle.
import unusedImports from "eslint-plugin-unused-imports";
import react from "eslint-plugin-react";
import globals from "globals";

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "unused-imports": unusedImports, react },
    rules: {
      // Mark identifiers referenced in JSX (`<Foo/>`, `<Foo.Bar/>`) as used.
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error", // safety for any classic-runtime files
      // Undeclared identifiers. ADDED 2026-08-10 after a production crash:
      // `modulesById` was referenced in a scope that never declared it, inside a
      // useCallback DEP ARRAY — which evaluates on every render, so every panel
      // holding an instance died with a ReferenceError.
      //
      // `npm run build` cannot catch this. Rollup resolves IMPORTS; an undeclared
      // identifier inside a function body is legal syntax and only throws at
      // runtime, so the build was clean while prod was down. Turning this rule on
      // found three MORE live instances the same afternoon (an ops-builder drop
      // indicator, an ops-builder field list, and the artifact "Replace image"
      // button). This is the only cheap check that catches the class.
      "no-undef": "error",
      // Auto-fixable: removes import specifiers nothing references.
      "unused-imports/no-unused-imports": "error",
      // Report-only (no autofix of arbitrary locals — reviewed by hand).
      "unused-imports/no-unused-vars": [
        "warn",
        { vars: "all", varsIgnorePattern: "^_", args: "none", ignoreRestSiblings: true },
      ],
    },
  },
  // Test files: vitest injects describe/it/expect/vi as globals. Without this
  // block `no-undef` reports every one of them — noise that would have made the
  // rule unusable and got it switched back off.
  {
    files: ["src/**/__tests__/**/*.{js,jsx}", "src/**/*.test.{js,jsx}", "src/**/setup*.{js,jsx}"],
    languageOptions: { globals: { ...globals.vitest } },
  },
];
