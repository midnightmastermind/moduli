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
// Layers (slices 1-7):
//   - DEFAULT_LAYOUT_BY_KIND          per-kind built-in defaults
//   - resolveDefaultLayout            built-in + hardcoded (page-in-container)
//   - mergeLayoutRules                partial-override merge (parent + child)
//   - resolveLayoutCascade            walks Grid → Panel → Page → Container → leaf
//   - buildLayoutCascadeContext       parent-chain bucketer
//   - resolveEffectiveLayout          one-call convenience: built default + cascade

import { buildParentMap } from "./dragHitTesting";

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

// q3 ii (2026-05-24) — kind: "board" was collapsed into kind:"board". Existing
// DB records / migrations may still produce `list` until they're migrated;
// alias it to the board defaults so unmigrated occurrences still resolve
// correctly. New seed code MUST write `kind:"board"`.
const CONTAINER_DEFAULTS = {
  doc:           { dragInView: "actual",         navOptions: ["actual"],                              navAllowChange: true, locked: false, showFieldsByDefault: true  },
  board:         { dragInView: "actual",         navOptions: ["representation", "actual"],            navAllowChange: true, locked: false, showFieldsByDefault: true  },
  canvas:        { dragInView: "representation", navOptions: ["preview", "representation", "actual"], navAllowChange: true, locked: false, showFieldsByDefault: false },
  table:         { dragInView: "actual",         navOptions: ["actual"],                              navAllowChange: true, locked: false, showFieldsByDefault: true  },
};
// Back-compat alias: any unmigrated `kind: "board"` gets board behavior.
CONTAINER_DEFAULTS.list = CONTAINER_DEFAULTS.board;

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
    if (context === "nestedInContainer") {
      // Page inside a container — full page chrome doesn't fit, so the
      // page renders either as a representation chip OR as a converted
      // container (renders the page's children inline with container-
      // style chrome). Defaults to `actual-converted` when dragged in
      // per Q2 direction (2026-05-24).
      return { ...EMPTY, dragInView: "actual-converted", navOptions: ["representation", "actual-converted"], navAllowChange: true };
    }
    if (context === "nestedInPage") {
      // Page inside another page — defaults to representation but CAN
      // be switched to actual (page-within-page primitive per #45) or
      // actual-converted (renders as inline container). When `actual` is
      // picked the inner page renders with --nested page chrome; when
      // `actual-converted` is picked it renders as a plain container.
      return { ...EMPTY, dragInView: "representation", navOptions: ["representation", "actual", "actual-converted"], navAllowChange: true };
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
  const parentMod = parent.targetId ? modulesById?.[parent.targetId] : null;
  const parentRole = parentMod?.role;
  if (parentRole === "page") return "nestedInPage";
  if (parentRole === "container") return "nestedInContainer";
  // Parent is a panel/folder/etc. — treat as top-level for layout purposes.
  return "topLevel";
}

// ── Per-level merge ──────────────────────────────────────────────────────
// Each layout-cascade rule is independently overridable. A child's
// `meta.layoutCascade = { dragInView: "preview" }` replaces only the
// dragInView; navOptions / locked / etc. flow through from the parent.
// `null` values explicitly clear (treated as "no opinion" at this level).
export function mergeLayoutRules(parent, child) {
  if (!child) return parent || null;
  if (!parent) return child;
  const out = { ...parent };
  for (const key of Object.keys(child)) {
    const v = child[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out;
}

// ── Cascade walker (Slice 6) ─────────────────────────────────────────────
// Walks Grid → Panel → Page → Container → Instance/leaf, layering
// `meta.layoutCascade` overrides on top of the per-kind default.
//
// Returns:
//   {
//     levels: [{ kind, label, contribution, source }],
//     resolved: { dragInView, navOptions, navAllowChange, ... },
//   }
//
// `ctx` shape:
//   { grid, panel, panelOcc, page, pageOcc, container, containerOcc,
//     leaf, leafOcc }
//
// Important: `page` / `container` / `panel` slots hold ANCESTORS only —
// they're NEVER the leaf itself, even when the leaf shares that role.
// The leaf always lives in `leaf` / `leafOcc`. This lets resolveLayoutCascade
// distinguish "I am a page" from "I am nested in a page" / "I am nested in
// a container", which drives the hardcoded page-in-container rule.
//
// `leafRole` + `leafKind` drive which per-kind default is used as the
// starting layer AND determine the page-in-container hardcoded rule.
export function resolveLayoutCascade(ctx, leafRole = "instance", leafKind = null) {
  const levels = [];

  // Determine context for the hardcoded page rules.
  let context = "topLevel";
  if (leafRole === "page") {
    if (ctx?.container) context = "nestedInContainer";
    else if (ctx?.page)  context = "nestedInPage";
  }

  // Layer 1: per-kind default (always present).
  const defaultLayer = resolveDefaultLayout({ role: leafRole, kind: leafKind, context });
  levels.push({ kind: "default", label: "Default", contribution: defaultLayer, source: `DEFAULT_LAYOUT_BY_KIND[${leafRole}.${leafKind}]` });
  let resolved = { ...defaultLayer };

  // Helper — push an override layer if present.
  function pushOverride(kind, label, layer, source) {
    if (!layer) return;
    levels.push({ kind, label, contribution: layer, source });
    resolved = mergeLayoutRules(resolved, layer);
  }

  // Layer 2: Grid default override.
  if (ctx?.grid?.meta?.layoutCascadeDefaults) {
    pushOverride("grid", "Grid default", ctx.grid.meta.layoutCascadeDefaults, "grid.meta.layoutCascadeDefaults");
  }

  // Layer 3-5: panel / page / container overrides via their occurrences' meta.
  if (ctx?.panelOcc?.meta?.layoutCascade) {
    pushOverride("panel", "Panel", ctx.panelOcc.meta.layoutCascade, "panelOcc.meta.layoutCascade");
  }
  if (ctx?.pageOcc?.meta?.layoutCascade) {
    pushOverride("page", "Page", ctx.pageOcc.meta.layoutCascade, "pageOcc.meta.layoutCascade");
  }
  if (ctx?.containerOcc?.meta?.layoutCascade) {
    pushOverride("container", "Container", ctx.containerOcc.meta.layoutCascade, "containerOcc.meta.layoutCascade");
  }

  // Layer 6: per-occurrence (leaf) override — strongest.
  // `leafOcc` is the canonical leaf slot; `instanceOcc` is a back-compat alias
  // for the original Slice 5 wiring (ViewModeSection / ContainerForm).
  const leafOcc = ctx?.leafOcc || ctx?.instanceOcc;
  if (leafOcc?.meta?.layoutCascadeOverride) {
    pushOverride(leafRole, "This placement", leafOcc.meta.layoutCascadeOverride, "leafOcc.meta.layoutCascadeOverride");
  }

  // Hardcoded rules trump any override.
  // Page-in-container: allows representation OR actual-converted.
  // Default is actual-converted (per Q2 2026-05-24); switcher exposes both.
  // `actual` is not offered here — containers don't have room for a full page.
  if (leafRole === "page" && context === "nestedInContainer") {
    resolved = { ...resolved, navOptions: ["representation", "actual-converted"], navAllowChange: true };
    if (resolved.dragInView !== "representation" && resolved.dragInView !== "actual-converted") {
      resolved.dragInView = "actual-converted";
    }
  }
  // Page-in-page: representation / actual / actual-converted all available.
  // Default is representation; user can pick actual (full nested page shell)
  // or actual-converted (renders as plain container). Per-occurrence
  // overrides survive — only navOptions are forced.
  if (leafRole === "page" && context === "nestedInPage") {
    resolved = { ...resolved, navOptions: ["representation", "actual", "actual-converted"], navAllowChange: true };
    if (!["representation", "actual", "actual-converted"].includes(resolved.dragInView)) {
      resolved.dragInView = "representation";
    }
  }
  // Standalone page: forced actual, no switcher.
  if (leafRole === "page" && context === "topLevel") {
    resolved = { ...resolved, dragInView: "actual", navOptions: [], navAllowChange: false };
  }

  return { levels, resolved };
}

// ── Cascade context builder (Slice 6) ────────────────────────────────────
// Walks an occurrence's parent chain (via occurrences[] reverse map,
// matching effectiveFilterFor / resolveStyleCascade semantics) and
// buckets ancestors by role into the ctx shape resolveLayoutCascade
// expects.
export function buildLayoutCascadeContext({ leafOccurrence, occurrencesById, modulesById, grid }) {
  const ctx = { grid };
  if (!leafOccurrence || !occurrencesById || !modulesById) return ctx;

  // Leaf — stored in its own slots, NEVER bucketed into an ancestor role slot.
  // This is critical: resolveLayoutCascade checks ctx.page / ctx.container
  // to detect "nested in a page" / "nested in a container". If we put a
  // page leaf into ctx.page, every top-level page would falsely classify
  // as nested.
  const leafMod = modulesById[leafOccurrence.targetId];
  ctx.leafOcc = leafOccurrence;
  ctx.leaf = leafMod || null;
  // Back-compat alias for the Slice 5 wiring that reads ctx.instanceOcc:
  ctx.instanceOcc = leafOccurrence;

  const parentByChildId = buildParentMap(occurrencesById);
  let cur = leafOccurrence;
  let safety = 32;
  const seen = new Set();
  // Walk UP — first ancestor of each role wins (closest parent). ANCESTORS
  // only — the leaf itself is excluded from these slots even if it shares
  // a role with an ancestor.
  while (cur && safety-- > 0) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    const parentId = parentByChildId[cur.id];
    cur = parentId ? occurrencesById[parentId] : null;
    if (!cur) break;
    const mod = modulesById[cur.targetId];
    if (!mod) continue;
    if (mod.role === "container" && !ctx.container) {
      ctx.container = mod; ctx.containerOcc = cur;
    } else if (mod.role === "page" && !ctx.page) {
      ctx.page = mod; ctx.pageOcc = cur;
    } else if (mod.role === "panel" && !ctx.panel) {
      ctx.panel = mod; ctx.panelOcc = cur;
    }
  }
  return ctx;
}

// ── Convenience: one-call resolution ─────────────────────────────────────
// Most consumers (drop handlers, switcher) just want the merged rules for
// an occurrence in its current placement. This wraps buildLayoutCascadeContext
// + resolveLayoutCascade into a single call.
export function resolveEffectiveLayout({ occurrence, occurrencesById, modulesById, grid }) {
  if (!occurrence) return resolveDefaultLayout({ role: "instance" });
  const mod = modulesById?.[occurrence.targetId];
  const role = mod?.role || "instance";
  const kind = mod?.kind || null;
  const ctx = buildLayoutCascadeContext({ leafOccurrence: occurrence, occurrencesById, modulesById, grid });
  return resolveLayoutCascade(ctx, role, kind).resolved;
}

// ── Effective view mode resolver ──────────────────────────────────────────
// Combines the cascade's `dragInView` (default for the placement) with the
// stored `occurrence.meta.viewMode` (per-occurrence user override).
// When the cascade forbids changes (`navAllowChange === false`), the cascade
// wins absolutely — a stale stored value can't override a hardcoded rule.
// When the cascade allows changes, the stored mode wins if it's in the
// allowed list; else falls back to the cascade's default.
export function resolveEffectiveViewModeFromCascade({ occurrence, occurrencesById, modulesById, grid }) {
  const layout = resolveEffectiveLayout({ occurrence, occurrencesById, modulesById, grid });
  const stored = occurrence?.meta?.viewMode;
  if (!layout) return stored || "actual";
  if (layout.navAllowChange === false) return layout.dragInView || "actual";
  if (stored && Array.isArray(layout.navOptions) && layout.navOptions.includes(stored)) {
    return stored;
  }
  return layout.dragInView || "actual";
}

// ── Drop integration (Slice 2) ────────────────────────────────────────────
// When an occurrence lands in a new destination, the destination's cascade
// dictates which view mode the new child renders as. Resolve the destination's
// effective `dragInView` and return the viewMode that should be stamped on
// the new child. Returns null when the destination doesn't override (so
// callers can skip the write).
//
// "destination" is the occurrence the new child is placed INTO (a container
// or page). The new child inherits the destination's `dragInView` policy:
// if the destination is a canvas-kind container, new children render as
// representation; if folder-page, new children render as preview.
export function resolveDropInViewMode({ destinationOccurrence, occurrencesById, modulesById, grid }) {
  if (!destinationOccurrence) return null;
  const layout = resolveEffectiveLayout({
    occurrence: destinationOccurrence,
    occurrencesById, modulesById, grid,
  });
  // Only stamp when the destination opts into a non-actual default — `actual`
  // is the universal fallback and stamping it everywhere adds DB churn.
  if (!layout || !layout.dragInView || layout.dragInView === "actual") return null;
  return layout.dragInView;
}

// ── Lock rule (Slice 4) ───────────────────────────────────────────────────
// A surface with `locked: true` (resolved through the cascade) says "my
// children can't be dragged OUT of me." Reorders within the same locked
// surface are still allowed; only moves that cross the boundary are blocked.
//
// Implementation walks the source occurrence's parent chain (closest →
// farthest) and finds the first ancestor whose RESOLVED cascade has
// `locked: true`. If the destination occurrence is also a descendant of (or
// equal to) that locked ancestor, the move is allowed. Otherwise the move
// is blocked.
//
// Returns:
//   { blocked: false }                  — no lock applies OR destination shares the locked ancestor
//   { blocked: true, lockedAncestorId } — move would cross out of `lockedAncestorId`
//
// Callers (dropHandlers) should `clearSession()` and bail when blocked.
// Pass the destination as `destinationOccurrence` (the container/page being
// moved INTO). For drag-to-grid-cell drops where there is no destination
// occurrence, pass `null` — that's treated as "leaving the locked surface".
export function isMoveBlockedByCascadeLock({
  sourceOccurrence,
  destinationOccurrence,
  occurrencesById,
  modulesById,
  grid,
}) {
  if (!sourceOccurrence || !occurrencesById || !modulesById) {
    return { blocked: false };
  }

  // Walk source's parent chain (closest → farthest) using the same reverse
  // map the rest of the cascade uses. The leaf itself is NOT a candidate
  // (a locked leaf would only mean "leaf's own children can't leave," not
  // "leaf can't leave itself").
  const parentByChildId = buildParentMap(occurrencesById);
  const sourceAncestors = [];
  {
    let cur = sourceOccurrence;
    let safety = 32;
    const seen = new Set();
    while (cur && safety-- > 0) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      const parentId = parentByChildId[cur.id];
      cur = parentId ? occurrencesById[parentId] : null;
      if (!cur) break;
      sourceAncestors.push(cur);
    }
  }

  // Identify the lock OWNERS in the source's ancestor chain.
  //
  // An owner is a surface whose OWN meta.layoutCascade.locked === true.
  // Inheriting `locked` through the cascade does NOT make a descendant a
  // boundary — the boundary is the level that DECLARED the rule. Picking
  // the boundary right is what makes "move from cA to sibling cB inside
  // lockedPage" succeed: cA inherits locked from lockedPage but only
  // lockedPage is the boundary.
  //
  // We also honor grid.meta.layoutCascadeDefaults.locked as a "grid is
  // the lock owner" rule — every cross-grid move is blocked when that's
  // set. For now no ancestor matches that case (the grid isn't an
  // occurrence) so callers should treat a grid-level lock as "always
  // blocked unless source and dest share an ancestor that wins above the
  // grid default" — out of scope for the closest-ancestor check below.
  const lockOwners = sourceAncestors.filter(anc => {
    const v = anc?.meta?.layoutCascade?.locked;
    return v === true;
  });

  // Closest-to-leaf owner first (sourceAncestors is already ordered
  // closest → farthest), but lock-containment is hierarchical: if dest is
  // inside the OUTERMOST owner (farthest from leaf) it's automatically
  // inside all inner ones too. We report the outermost as the boundary
  // since that's the meaningful "you're trying to leave this" anchor.
  const lockedAncestor = lockOwners.length > 0
    ? lockOwners[lockOwners.length - 1]
    : null;

  if (!lockedAncestor) return { blocked: false };

  // No destination occurrence → moving out of the grid context entirely.
  // Treat as "leaving the locked surface."
  if (!destinationOccurrence) {
    return { blocked: true, lockedAncestorId: lockedAncestor.id };
  }

  // Destination is the locked ancestor itself OR a descendant of it → still inside.
  if (destinationOccurrence.id === lockedAncestor.id) {
    return { blocked: false };
  }

  // Walk destination's parent chain — if the locked ancestor is in it, the
  // destination is still inside the locked surface.
  let cur = destinationOccurrence;
  let safety = 32;
  const seen = new Set();
  while (cur && safety-- > 0) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    const parentId = parentByChildId[cur.id];
    if (!parentId) break;
    if (parentId === lockedAncestor.id) return { blocked: false };
    cur = occurrencesById[parentId];
  }

  return { blocked: true, lockedAncestorId: lockedAncestor.id };
}
