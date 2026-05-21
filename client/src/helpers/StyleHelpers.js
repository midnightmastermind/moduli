// StyleHelpers.js — Cascading style resolution
// ============================================================
// Mirrors resolveEffectiveIteration pattern:
//   Panel → Container → Instance
// Each level can "inherit" (use parent defaults) or "own" (override).
// ============================================================

// Default shape — all null means "inherit everything"
export const DEFAULT_ENTITY_STYLE = {
  bg: null,           // CSS color string
  textColor: null,    // CSS color string
  border: null,       // e.g. "1px solid #444"
  borderRadius: null, // e.g. "8px"
  opacity: null,      // 0-1
  fontSize: null,     // e.g. "14px"
  padding: null,      // e.g. "8px"
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
 * Only includes non-null properties.
 */
export function styleToCSS(style) {
  if (!style) return {};
  const css = {};
  if (style.bg != null) css.backgroundColor = style.bg;
  if (style.textColor != null) css.color = style.textColor;
  if (style.border != null) css.border = style.border;
  if (style.borderRadius != null) css.borderRadius = style.borderRadius;
  if (style.opacity != null) css.opacity = style.opacity;
  if (style.fontSize != null) css.fontSize = style.fontSize;
  if (style.padding != null) css.padding = style.padding;
  return css;
}
