// helpers/layoutCascade.js
//
// CSS-cascade-style resolver for occurrence layout/behaviour rules:
//   - dragInView          which view (preview/representation/actual) a new
//                         occurrence renders as when dropped into this surface
//   - navOptions          which switcher buttons appear on the occurrence
//   - navAllowChange      false = locked to dragInView (page-in-container case)
//   - dropAccepts         which child role+kind tuples this surface accepts
//   - locked              when true, children can't be dragged out of this surface
//   - showFieldsByDefault representation view shows fields by default vs label+icon only
//
// Spec: docs/superpowers/specs/2026-05-22-layout-cascade-spec.md
//
// Slice 1 (this file) ships only DEFAULT_LAYOUT_BY_KIND + `resolveDefaultLayout`.
// Override walking, per-occurrence/per-container/per-page/per-panel/per-grid
// overrides, and the LayoutCascadeEditor UI are follow-up slices (see spec).
// Drop handlers + ViewModeSwitcher can consume the default-only resolver
// today; the full cascade walk is wire-compatible upgrade.

// ── Per-kind defaults ─────────────────────────────────────────────────────
// Special hardcoded rules (page-in-container forced representation,
// standalone page forced actual) are applied in resolveDefaultLayout
// AFTER the per-kind lookup so they always win.

const PAGE_DEFAULTS = {
  folder:        { dragInView: "preview",        navOptions: ["preview", "representation"],         navAllowChange: true, locked: false, showFieldsByDefault: true  },
  board:         { dragInView: "actual",         navOptions: ["preview", "representation", "actual"], navAllowChange: true, locked: false, showFieldsByDefault: true  },
  doc:           { dragInView: "actual",         navOptions: ["preview", "representation", "actual"], navAllowChange: true, locked: false, showFieldsByDefault: true  },
  canvas:        { dragInView: "representation", navOptions: ["preview", "representation", "actual"], navAllowChange: true, locked: false, showFieldsByDefault: false },
  table:         { dragInView: "actual",         navOptions: ["representation", "actual"],            navAllowChange: true, locked: false, showFieldsByDefault: true  },
};

const CONTAINER_DEFAULTS = {
  list:          { dragInView: "actual",         navOptions: ["actual"],                              navAllowChange: true, locked: false, showFieldsByDefault: true  },
  doc:           { dragInView: "actual",         navOptions: ["actual"],                              navAllowChange: true, locked: false, showFieldsByDefault: true  },
  board:         { dragInView: "actual",         navOptions: ["representation", "actual"],            navAllowChange: true, locked: false, showFieldsByDefault: true  },
  canvas:        { dragInView: "representation", navOptions: ["preview", "representation", "actual"], navAllowChange: true, locked: false, showFieldsByDefault: false },
  table:         { dragInView: "actual",         navOptions: ["actual"],                              navAllowChange: true, locked: false, showFieldsByDefault: true  },
};

const LEAF_DEFAULTS = {
  instance:      { dragInView: "actual",         navOptions: ["actual"],                              navAllowChange: true, locked: false, showFieldsByDefault: true  },
  artifact:      { dragInView: "actual",         navOptions: ["preview", "actual"],                   navAllowChange: true, locked: false, showFieldsByDefault: true  },
  textblock:     { dragInView: "actual",         navOptions: ["actual"],                              navAllowChange: true, locked: false, showFieldsByDefault: true  },
};

export const DEFAULT_LAYOUT_BY_KIND = {
  page: PAGE_DEFAULTS,
  container: CONTAINER_DEFAULTS,
  // Leaf roles ignore kind dimension; lookups for instance/artifact/textblock
  // are short-circuited in resolveDefaultLayout.
};

const EMPTY = Object.freeze({ dragInView: "actual", navOptions: ["actual"], navAllowChange: true, locked: false, showFieldsByDefault: true });

/**
 * Resolve the default layout rules for a given (role, kind) tuple.
 *
 * @param {Object} args
 * @param {string} args.role - "page" | "container" | "instance" | "artifact" | "textblock" | "panel"
 * @param {string} args.kind - "folder" | "board" | "doc" | "canvas" | "table" | "list" (kind ignored for leaf roles)
 * @param {string} [args.context] - "topLevel" | "nestedInPage" | "nestedInContainer" — special-case overrides
 * @returns {Object} resolved layout rule object (always returns a complete shape)
 */
export function resolveDefaultLayout({ role, kind, context = "topLevel" } = {}) {
  // Special hardcoded rules (always win over per-kind defaults).
  if (role === "page") {
    if (context === "nestedInPage" || context === "nestedInContainer") {
      // Page inside another page/container — forced representation, no switcher.
      return { ...EMPTY, dragInView: "representation", navOptions: ["representation"], navAllowChange: false };
    }
    if (context === "topLevel") {
      // Standalone page (panel content) — always actual, can't switch.
      const kindDefault = PAGE_DEFAULTS[kind] || EMPTY;
      return { ...kindDefault, dragInView: "actual", navOptions: [], navAllowChange: false };
    }
  }

  if (role === "instance")  return { ...LEAF_DEFAULTS.instance };
  if (role === "artifact")  return { ...LEAF_DEFAULTS.artifact };
  if (role === "textblock") return { ...LEAF_DEFAULTS.textblock };
  if (role === "panel")     return { ...EMPTY }; // panels are scaffolding, not occurrence-rendered

  const lookup = DEFAULT_LAYOUT_BY_KIND[role]?.[kind];
  if (lookup) return { ...lookup };
  return { ...EMPTY };
}

/**
 * Determine the "context" arg for resolveDefaultLayout based on an
 * occurrence's ancestor chain. Pass the result of buildParentMap +
 * the occurrence itself.
 *
 * @param {Object} args
 * @param {Object} args.occurrence
 * @param {Object} args.occurrencesById
 * @param {Object} args.modulesById
 * @returns {"topLevel" | "nestedInPage" | "nestedInContainer"}
 */
export function classifyOccurrenceContext({ occurrence, occurrencesById, modulesById }) {
  if (!occurrence?.parentId) return "topLevel";
  const parent = occurrencesById?.[occurrence.parentId];
  if (!parent) return "topLevel";
  const parentMod = parent.moduleId ? modulesById?.[parent.moduleId] : null;
  const parentRole = parentMod?.role;
  if (parentRole === "page") return "nestedInPage";
  if (parentRole === "container") return "nestedInContainer";
  // Parent is a panel/folder/etc. — treat as top-level for layout purposes.
  return "topLevel";
}

// ── Slice 2-7 stubs (full cascade walk) ───────────────────────────────────
// Future: resolveLayoutCascade({ leafKind, leafRole, ancestorChain }) walks
// grid → ... → leafOccurrence and merges per-level meta.layoutCascade
// overrides. Mirrors resolveStyleCascade in helpers/StyleHelpers.js.
// See spec doc for the full plan.
