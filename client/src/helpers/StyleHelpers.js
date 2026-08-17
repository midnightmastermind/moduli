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
export function resolveContainerStyle(container, panel, occurrence, grid = null) {
  // Cascade root — Grid default first (when present). Optional 4th
  // arg so legacy call sites that don't pass it stay byte-identical
  // (no grid → no contribution → previous behavior).
  let result = grid?.meta?.defaultStyle || null;
  if (panel?.childContainerStyle) {
    result = mergeStyles(result, panel.childContainerStyle);
  }
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
export function resolveInstanceStyle(instance, container, panel, grid = null) {
  // Cascade root — Grid default first when present (optional 4th
  // arg keeps legacy callers byte-identical).
  let base = grid?.meta?.defaultStyle || null;

  // Panel-level defaults for instances
  if (panel?.childInstanceStyle) {
    base = mergeStyles(base, panel.childInstanceStyle);
  }

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

  // ── Semantic rule (matches the legacy resolveContainerStyle /
  //    resolveInstanceStyle walkers) ─────────────────────────────
  // ownStyle (and its per-placement overlay) describes how THIS
  // entity looks — it does NOT flow down to descendants. Only the
  // per-level push-down keys (childContainerStyle /
  // childInstanceStyle) cascade. Therefore each level emits:
  //   - its ownStyle + occ.ownStyle    ONLY when it IS the leaf
  //   - its childXxxStyle              ONLY when the leaf is below
  //
  // Both rows still surface in the editor's "Inherited cascade"
  // view (read-only) so the user can see what's contributing.

  // Panel level
  if (ctx?.panel) {
    if (leafKind === "panel") {
      if (ctx.panel.styleMode === "own" && ctx.panel.ownStyle) {
        pushLevel("panel", "Panel", ctx.panel.ownStyle, "panel.ownStyle");
      }
      if (ctx.panelOcc?.ownStyle) {
        pushLevel("panel", "Panel (placement)", ctx.panelOcc.ownStyle, "panelOcc.ownStyle");
      }
    } else if (ctx.panel.childContainerStyle || ctx.panel.childInstanceStyle) {
      // Descendant resolution — choose the push-down key that matches
      // the leaf chain. Pages / containers inherit panel.childContainerStyle;
      // instances / textblocks / artifacts inherit panel.childInstanceStyle.
      const key = (leafKind === "instance" || leafKind === "textblock" || leafKind === "artifact")
        ? (ctx.panel.childInstanceStyle ? "childInstanceStyle" : "childContainerStyle")
        : "childContainerStyle";
      const contribution = ctx.panel[key];
      if (contribution) pushLevel("panel-child", `Panel → ${key === "childInstanceStyle" ? "instances" : "containers"}`, contribution, `panel.${key}`);
    }
  }

  // Page level
  if (ctx?.page) {
    if (leafKind === "page") {
      if (ctx.page.styleMode === "own" && ctx.page.ownStyle) {
        pushLevel("page", "Page", ctx.page.ownStyle, "page.ownStyle");
      }
      if (ctx.pageOcc?.ownStyle) {
        pushLevel("page", "Page (placement)", ctx.pageOcc.ownStyle, "pageOcc.ownStyle");
      }
    } else {
      const key = (leafKind === "instance" || leafKind === "textblock" || leafKind === "artifact")
        ? (ctx.page.childInstanceStyle ? "childInstanceStyle" : "childContainerStyle")
        : "childContainerStyle";
      const contribution = ctx.page?.[key];
      if (contribution) pushLevel("page-child", `Page → ${key === "childInstanceStyle" ? "instances" : "containers"}`, contribution, `page.${key}`);
    }
  }

  // Container level
  if (ctx?.container) {
    if (leafKind === "container") {
      if (ctx.container.styleMode === "own" && ctx.container.ownStyle) {
        pushLevel("container", "Container", ctx.container.ownStyle, "container.ownStyle");
      }
      if (ctx.containerOcc?.ownStyle) {
        pushLevel("container", "Container (placement)", ctx.containerOcc.ownStyle, "containerOcc.ownStyle");
      }
    } else if (ctx.container.childInstanceStyle && (leafKind === "instance" || leafKind === "textblock" || leafKind === "artifact")) {
      pushLevel("container-child", "Container → instances", ctx.container.childInstanceStyle, "container.childInstanceStyle");
    }
  }

  // Instance / textblock / artifact leaf — only contributes at its own level
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
 * HOW OPAQUE A SURFACE'S OWN STORED COLOUR RENDERS.
 *
 * User 2026-08-17: "nothing else is transparent. make each transparacy as light
 * as possible. on all occurances (the backgrounds of them and headers)."
 *
 * The grid has a wallpaper behind it, and the CSS tokens (`--grid-surface-a`,
 * `--occ-card-a`) only reach surfaces that fall back to the stylesheet. A
 * container or instance carrying its own `ownStyle.bg` renders that colour as an
 * INLINE style, which beats any rule at any specificity — measured on prod, one
 * such container came back `rgb(179,79,36)`, fully opaque, showing none of the
 * wallpaper. So the transparency has to be applied where the stored colour
 * BECOMES css, which is here: the one chokepoint every surface passes through.
 *
 * `App.jsx` publishes this same number as `--grid-surface-a` so the CSS and JS
 * halves cannot drift — one authority, not two that must be kept equal.
 */
/**
 * ALPHA COMPOUNDS, SO THIS IS PICKED FOR THE DEEPEST STACK, NOT A SINGLE CARD.
 *
 * Measured on the live grid: the worst case is SIX painting surfaces between the
 * eye and the wallpaper (an imported doc nests sections five deep inside a
 * panel), and 56 of them repaint the SAME teal. Transmission is `(1 - a)^6`:
 *
 *   a = 0.45   4.5%   reads as a solid slab — the user's report
 *   a = 0.35   7.5%
 *   a = 0.18    30%   the wallpaper is genuinely visible at full depth
 *
 * 0.45 ALSO COULD NOT BITE. Those 56 surfaces are stored at 0.35, already under
 * that cap, so `withSurfaceAlpha`'s `min()` left every one of them unchanged —
 * the knob was inert on precisely the surfaces that dominate the stack. A value
 * here only does anything below the lowest stored alpha.
 *
 * Only the ALPHA is ours; the hue is the user's, and it survives. Text, borders
 * and icons are never faded — they are not surfaces you look through.
 */
export const SURFACE_ALPHA = 0.18;

/**
 * Re-render a colour at (at most) `alpha`.
 *
 * Takes the MINIMUM rather than multiplying: a colour already stored
 * translucent is already at least this light, and compounding would push it
 * toward invisible. Hex and rgb/rgba are handled because those are what the
 * colour picker and the seed actually write; anything else (a named colour,
 * hsl, a var(), a gradient) is returned UNCHANGED — failing safe to today's
 * appearance beats emitting a value the engine drops on the floor.
 */
export function withSurfaceAlpha(color, alpha = SURFACE_ALPHA) {
  if (typeof color !== "string") return color;
  const s = color.trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return color;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return `rgba(${r}, ${g}, ${b}, ${Math.min(a, alpha)})`;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (rgb) {
    const [, r, g, b, rawA] = rgb;
    const a = rawA == null ? 1
      : rawA.endsWith("%") ? parseFloat(rawA) / 100
      : parseFloat(rawA);
    if (!Number.isFinite(a)) return color;
    return `rgba(${r}, ${g}, ${b}, ${Math.min(a, alpha)})`;
  }

  return color;
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
  // The stored colour renders TRANSLUCENT so the grid's wallpaper reads through
  // it — see SURFACE_ALPHA. The hue is the user's; only the alpha is ours.
  if (style.bg != null)         css.backgroundColor = withSurfaceAlpha(style.bg);
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
