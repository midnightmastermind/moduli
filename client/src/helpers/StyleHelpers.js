// StyleHelpers.js — Cascading style resolution
// ============================================================
// Mirrors resolveEffectiveIteration pattern:
//   Grid → Panel → Page → Container → Instance
// Each level can "inherit" (use parent defaults) or "own" (override).
// ============================================================

import { buildParentMap } from "./dragHitTesting";

// Default shape — all null means "inherit everything".
// Granular border + font fields let the cascade override pieces
// independently (a parent's borderColor can be replaced without
// also re-specifying borderWidth / borderStyle, etc.).
export const DEFAULT_ENTITY_STYLE = {
  bg: null,            // CSS color string
  textColor: null,     // CSS color string
  // Legacy single-string border (e.g. "1px solid #444"). Still honored
  // for back-compat — present rows in the seed use it. New writes
  // should prefer the granular trio below.
  border: null,
  borderColor: null,   // e.g. "#444" — overrides the color part of `border` when both set
  borderWidth: null,   // e.g. "1px"
  borderStyle: null,   // "solid" | "dashed" | "dotted" | "double" | "none"
  borderRadius: null,  // e.g. "8px"
  opacity: null,       // 0-1
  fontFamily: null,    // e.g. "var(--font-mono)" or "Inter, sans-serif"
  fontSize: null,      // e.g. "14px"
  fontWeight: null,    // 100-900 or "normal" / "bold"
  lineHeight: null,    // e.g. "1.4" or "20px"
  padding: null,       // e.g. "8px"
};

/**
 * Merge two style objects. Non-null child values override parent values.
 */
export function mergeStyles(parent, child) {
  if (!child) return parent || null;
  if (!parent) return child;
  const result = {};
  const keys = new Set([...Object.keys(parent), ...Object.keys(child)]);
  for (const key of keys) {
    const childVal = child[key];
    result[key] = childVal != null ? childVal : parent[key] ?? null;
  }
  return result;
}

/**
 * Resolve effective container style.
 * Walk: panel.childContainerStyle → container.ownStyle (if mode=own)
 *       → occurrence.ownStyle (per-placement override, overlays everything).
 *
 * Per-occurrence override lets the same container module render differently
 * in different placements (e.g. a Schedule slot stamped red by the "Mark
 * Passed Timeslots" op affects only that day's occurrence, not the shared
 * module).
 */
export function resolveContainerStyle(container, panel, occurrence) {
  const panelDefault = panel?.childContainerStyle || null;

  let result = panelDefault;
  if (container?.styleMode === "own" && container?.ownStyle) {
    result = mergeStyles(result, container.ownStyle);
  }
  if (occurrence?.ownStyle) {
    result = mergeStyles(result, occurrence.ownStyle);
  }
  return result;
}

/**
 * Resolve effective instance style.
 * Walk: panel.childInstanceStyle → container.childInstanceStyle → instance.ownStyle (if mode=own)
 */
export function resolveInstanceStyle(instance, container, panel) {
  // Start with panel-level defaults for instances
  let base = panel?.childInstanceStyle || null;

  // Layer container-level defaults for instances
  if (container?.childInstanceStyle) {
    base = mergeStyles(base, container.childInstanceStyle);
  }

  // If instance has own style mode, overlay its own style
  if (instance?.styleMode === "own" && instance?.ownStyle) {
    return mergeStyles(base, instance.ownStyle);
  }

  return base;
}

/**
 * Style fields each entity kind exposes. The editor reads this map to
 * decide which controls to render — Grid-level defaults touch every
 * field, while a textblock might only meaningfully use fonts + text
 * color. Fields not listed for a kind still resolve through the
 * cascade (so a Grid `bg` reaches an instance via the merge chain)
 * but the editor won't surface them as inputs at that level.
 *
 * NOTE: kept as a permissive whitelist. The cascade itself is fully
 * generic; this just shapes the editor UX so it's tailored per the
 * user's per-type spec.
 */
/**
 * Walk up `leafOccurrence`'s parent chain via the shared
 * `buildParentMap` reverse map and bucket each ancestor's module by
 * role, returning a `ctx` shaped for `resolveStyleCascade`. Use this
 * from the form code (ContainerForm / InstanceForm) so the editor's
 * cascade view shows what every ancestor is pushing down before the
 * user picks an override.
 *
 *   buildStyleCascadeContext({
 *     leafOccurrence,
 *     occurrencesById,
 *     modulesById,
 *     grid,
 *   }) → { grid, panel, panelOcc, page, pageOcc, container, containerOcc, instance, instanceOcc }
 *
 * Buckets resolve closest-to-leaf-wins (first match per role kept).
 * Safety-capped at 32 hops in case of a malformed `occurrences[]` ring.
 */
export function buildStyleCascadeContext({ leafOccurrence, occurrencesById, modulesById, grid }) {
  const ctx = { grid };
  if (!leafOccurrence || !occurrencesById || !modulesById) return ctx;
  const parentByChildId = buildParentMap(occurrencesById);
  let cur = leafOccurrence;
  let safety = 32;
  const seen = new Set();
  while (cur && safety-- > 0) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    const mod = modulesById[cur.targetId];
    if (mod) {
      if (mod.role === "container" && !ctx.container) {
        ctx.container = mod;
        ctx.containerOcc = cur;
      } else if (mod.role === "page" && !ctx.page) {
        ctx.page = mod;
        ctx.pageOcc = cur;
      } else if (mod.role === "panel" && !ctx.panel) {
        ctx.panel = mod;
        ctx.panelOcc = cur;
      } else if ((mod.role === "instance" || mod.role === "textblock" || mod.role === "artifact") && !ctx.instance) {
        ctx.instance = mod;
        ctx.instanceOcc = cur;
      }
    }
    const parentId = parentByChildId[cur.id];
    cur = parentId ? occurrencesById[parentId] : null;
  }
  return ctx;
}

export const STYLE_FIELDS_BY_KIND = {
  grid:      ["bg", "textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "borderColor", "borderWidth", "borderStyle", "borderRadius", "padding", "opacity"],
  panel:     ["bg", "textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "border", "borderColor", "borderWidth", "borderStyle", "borderRadius", "padding", "opacity"],
  page:      ["bg", "textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "borderColor", "borderRadius", "padding", "opacity"],
  container: ["bg", "textColor", "fontFamily", "fontSize", "fontWeight", "border", "borderColor", "borderWidth", "borderStyle", "borderRadius", "padding", "opacity"],
  instance:  ["bg", "textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "borderColor", "borderRadius", "padding", "opacity"],
  textblock: ["textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "padding", "opacity"],
  artifact:  ["bg", "borderColor", "borderRadius", "padding", "opacity"],
};

/**
 * Walk the cascade Grid → Panel → Page → Container → (Instance) and
 * return the ordered ancestor list along with the merged effective
 * style. Lets the editor render a row per ancestor showing what each
 * contributes, plus the final resolved style.
 *
 * Inputs are passed loosely — any ancestor that's null is skipped so
 * callers can use this from a partial chain (e.g. a Grid-level style
 * editor passes only `{ grid }`).
 *
 *   ctx: {
 *     grid:      Grid record (`grid.meta.defaultStyle` is the grid root)
 *     panel:     Module of role:"panel"
 *     panelOcc:  Occurrence of the panel
 *     page:      Module of role:"page"
 *     pageOcc:   Occurrence of the page
 *     container: Module of role:"container"
 *     containerOcc: Occurrence of the container
 *     instance:  Module of role:"instance"
 *     instanceOcc: Occurrence of the instance (per-placement override)
 *   }
 *
 *   leafKind: which ancestor is the leaf (used to short-circuit the
 *             walk so a Page editor doesn't include Container/Instance
 *             rows that don't exist in its chain).
 *
 * For each level, the cascade considers TWO contributions:
 *   - module.ownStyle (when styleMode === "own") — the "what this
 *     entity looks like" style
 *   - module.childContainerStyle / module.childInstanceStyle — defaults
 *     this entity pushes DOWN to its children
 *   - occurrence.ownStyle — per-placement overlay (final say at each
 *     level)
 *
 * Returns:
 *   {
 *     levels: [{ kind, label, contribution: styleObj, source }],
 *     resolved: styleObj      // merged top-down (closer ancestor wins)
 *   }
 */
export function resolveStyleCascade(ctx, leafKind = "instance") {
  const levels = [];
  let resolved = null;

  function pushLevel(kind, label, contribution, source) {
    if (!contribution) return;
    levels.push({ kind, label, contribution, source });
    resolved = mergeStyles(resolved, contribution);
  }

  // Grid root — `grid.meta.defaultStyle` is the system-wide default
  // pushed down from the Grid settings tab. Optional; null when the
  // user hasn't set one.
  if (ctx?.grid?.meta?.defaultStyle) {
    pushLevel("grid", "Grid default", ctx.grid.meta.defaultStyle, "grid.meta.defaultStyle");
  }

  // Panel level — push panel's ownStyle, then its child-defaults the
  // children will inherit further down.
  if (ctx?.panel && (leafKind === "panel" || leafKind === "page" || leafKind === "container" || leafKind === "instance" || leafKind === "textblock" || leafKind === "artifact")) {
    if (ctx.panel.styleMode === "own" && ctx.panel.ownStyle) {
      pushLevel("panel", "Panel", ctx.panel.ownStyle, "panel.ownStyle");
    }
    if (ctx.panelOcc?.ownStyle) {
      pushLevel("panel", "Panel (placement)", ctx.panelOcc.ownStyle, "panelOcc.ownStyle");
    }
    if (leafKind !== "panel" && ctx.panel.childContainerStyle) {
      pushLevel("panel-child", "Panel → children", ctx.panel.childContainerStyle, "panel.childContainerStyle");
    }
  }

  // Page level
  if (ctx?.page && (leafKind === "page" || leafKind === "container" || leafKind === "instance" || leafKind === "textblock" || leafKind === "artifact")) {
    if (ctx.page.styleMode === "own" && ctx.page.ownStyle) {
      pushLevel("page", "Page", ctx.page.ownStyle, "page.ownStyle");
    }
    if (ctx.pageOcc?.ownStyle) {
      pushLevel("page", "Page (placement)", ctx.pageOcc.ownStyle, "pageOcc.ownStyle");
    }
    if (leafKind !== "page" && ctx.page.childContainerStyle) {
      pushLevel("page-child", "Page → children", ctx.page.childContainerStyle, "page.childContainerStyle");
    }
  }

  // Container level
  if (ctx?.container && (leafKind === "container" || leafKind === "instance" || leafKind === "textblock" || leafKind === "artifact")) {
    if (ctx.container.styleMode === "own" && ctx.container.ownStyle) {
      pushLevel("container", "Container", ctx.container.ownStyle, "container.ownStyle");
    }
    if (ctx.containerOcc?.ownStyle) {
      pushLevel("container", "Container (placement)", ctx.containerOcc.ownStyle, "containerOcc.ownStyle");
    }
    if (leafKind !== "container" && ctx.container.childInstanceStyle) {
      pushLevel("container-child", "Container → children", ctx.container.childInstanceStyle, "container.childInstanceStyle");
    }
  }

  // Instance / textblock / artifact leaf
  if (ctx?.instance && (leafKind === "instance" || leafKind === "textblock" || leafKind === "artifact")) {
    if (ctx.instance.styleMode === "own" && ctx.instance.ownStyle) {
      pushLevel(leafKind, "This entity", ctx.instance.ownStyle, "instance.ownStyle");
    }
    if (ctx.instanceOcc?.ownStyle) {
      pushLevel(leafKind, "This placement", ctx.instanceOcc.ownStyle, "instanceOcc.ownStyle");
    }
  }

  return { levels, resolved };
}

/**
 * Convert a resolved style object into React inline styles.
 * Only includes non-null properties. The granular border trio is
 * applied AFTER the legacy `border` shorthand so a partial override
 * (e.g. just borderColor) replaces only that one piece while the rest
 * of the parent's shorthand sticks.
 */
export function styleToCSS(style) {
  if (!style) return {};
  const css = {};
  if (style.bg != null)         css.backgroundColor = style.bg;
  if (style.textColor != null)  css.color = style.textColor;
  if (style.border != null)     css.border = style.border;
  if (style.borderColor != null) css.borderColor = style.borderColor;
  if (style.borderWidth != null) css.borderWidth = style.borderWidth;
  if (style.borderStyle != null) css.borderStyle = style.borderStyle;
  if (style.borderRadius != null) css.borderRadius = style.borderRadius;
  if (style.opacity != null)    css.opacity = style.opacity;
  if (style.fontFamily != null) css.fontFamily = style.fontFamily;
  if (style.fontSize != null)   css.fontSize = style.fontSize;
  if (style.fontWeight != null) css.fontWeight = style.fontWeight;
  if (style.lineHeight != null) css.lineHeight = style.lineHeight;
  if (style.padding != null)    css.padding = style.padding;
  return css;
}
