// ui/menuText.js
// ============================================================
// THE TYPE RAMP FOR THE PAGE / PANEL SETTINGS MENU.
//
// The nine sections of that menu (Filters, Feed, Graph, Sort, Field
// visibility, Field bindings, View mode, Layout cascade, Templates) each grew
// their own caption style, and they converged on the same two mistakes:
// `fontSize: 9` and `var(--text-faint)`.
//
// MEASURED ON THE STARDEW SURFACE (cream, rgb(236,227,208)) rather than
// eyeballed — a colour claim is not settled until the number moves on a case
// whose answer you already know:
//
//     --text-faint  (what shipped)   2.30:1   FAILS AA, and is the complaint
//     --text-muted                   4.10:1   still under AA
//     --text-primary                12.31:1   passes
//
// So a CAPTION takes primary ink. It is uppercase, letter-spaced and 12px, so
// it reads as the section heading it is rather than as body text — the weight
// comes from the type treatment, not from a washed-out colour.
//
// 12px is this repo's floor (2026-08-24 (3), 138 sites). That pass scoped
// itself to "the grid surface and NOT Command Center / editor chrome", and
// this menu was read as chrome — but it is a settings surface the user reads,
// which is exactly what the floor exists for.
//
// REPORTED, NOT CHANGED: `--text-muted` measures 4.10:1 on the light skins,
// i.e. under AA on its own. Strengthening the TOKEN would reach ~220 sites on
// three skins, which is a wider visual decision than this menu.
// ============================================================

// An uppercase section heading — "FEED", "SORT CHILDREN", "GRAPH".
export const MENU_CAPTION = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
};

// Supporting text under a control — counts, units, "pull:", empty states.
export const MENU_HINT = {
  fontSize: 12,
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
};
