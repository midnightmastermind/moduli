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
      // Auto-fixable: removes import specifiers nothing references.
      "unused-imports/no-unused-imports": "error",
      // Report-only (no autofix of arbitrary locals — reviewed by hand).
      "unused-imports/no-unused-vars": [
        "warn",
        { vars: "all", varsIgnorePattern: "^_", args: "none", ignoreRestSiblings: true },
      ],
    },
  },
];
