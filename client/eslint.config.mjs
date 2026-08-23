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
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";
import globals from "globals";

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    // ── DO NOT let --fix touch eslint-disable comments ────────────────────
    // ESLint 9 defaults `reportUnusedDisableDirectives` to "warn", and --fix
    // DELETES the directives it considers unused, leaving stray whitespace.
    // Running it once (2026-08-23) stripped `eslint-disable-next-line
    // react-hooks/exhaustive-deps` from 24 files — comments that sit directly
    // above deliberately-omitted deps and are explained in the folder CLAUDE.md.
    // The autofix would have quietly deleted the reasoning and left the code.
    //
    // This is the second form of the documented --fix hazard: the first
    // (2026-07-14) gutted the bundle by stripping JSX-only imports.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "unused-imports": unusedImports, react, "react-hooks": reactHooks },
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
      // ── react-hooks, REGISTERED 2026-08-23 ──────────────────────────────
      // NOT for the rules themselves at first — 17 files carry 36
      // `eslint-disable-next-line react-hooks/exhaustive-deps` comments, and
      // ESLint ERRORS on a directive that disables a rule it does not know
      // ("Definition for rule ... was not found"). So `npm run lint` exited
      // non-zero on completely clean code, which is very likely why nobody ran
      // it — and lint is the ONLY check that catches an undefined identifier
      // (2026-08-23: I shipped `ctxGrid is not defined`, took every panel on
      // prod down, and BOTH the test suite and the build passed).
      //
      // Both are WARNINGS (user's call), so `npm run lint` exits 0 on clean
      // code and can finally be used as a gate. `no-undef` is the rule the gate
      // exists for.
      //
      // `rules-of-hooks` reports 10 real violations across 4 files
      // (OperationsBuilder, ModuleContainer, TextblockCard, Field) and I have
      // NOT diagnosed them. It is the class that has bitten this repo before —
      // BoundHeader carried a `useMemo` after an early return, which changes
      // the hook COUNT between renders (modules/CLAUDE.md 2026-08-11) — so they
      // are warnings rather than silently switched off, and they are filed.
      // Do NOT raise this to "error" without fixing those 10 first, or the gate
      // goes red and stops being run again.
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
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
