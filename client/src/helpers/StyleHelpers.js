// StyleHelpers.js — Cascading style resolution
// ============================================================
// Mirrors resolveEffectiveIteration pattern:
//   Panel → Container → Instance
// Each level can "inherit" (use parent defaults) or "own" (override).
// ============================================================

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
