// helpers/viewMode.js
//
// Per-occurrence-placement view mode — controls how an occurrence renders
// where it lives. Stored on `occurrence.meta.viewMode` so no Occurrence
// schema change is needed; generic update_occurrence already persists
// `meta` as Mixed.
//
// Three modes:
//   - "preview"        — small thumbnail (folder-page iframe, mind-map
//                        preview node). The user can drill in to see the
//                        full thing at its native location.
//   - "representation" — compact `[Icon] Label` chip. Used for mind-map
//                        nodes that point at another occurrence without
//                        recursing into its content. Clickable jump-to.
//   - "actual"         — full render — whatever the parent context normally
//                        shows (ModuleInstance / ModuleContainer / Page).
//
// Default resolution chain:
//   1. Explicit `occurrence.meta.viewMode` wins.
//   2. Context-specific default (e.g. folder-page → "preview", mind-map
//      canvas → "representation").
//   3. Global default → "actual".
//
// Folder-page context CONSTRAINT: the Actual view is NEVER offered there.
// The switcher hides it; if a stale `viewMode: "actual"` somehow lands on
// a folder-page card, it's coerced back to "preview".

export const VIEW_MODES = ["preview", "representation", "actual", "actual-converted"];

export const VIEW_MODE_LABELS = {
  preview:        "Preview",
  representation: "Representation",
  actual:         "Actual",
  "actual-converted": "Actual (as container)",
};

// Context tags — callers pass `context` (a short string) to influence
// defaults + the available-modes list.
export const VIEW_MODE_CONTEXTS = {
  // Default everywhere — full Actual render available.
  default:      { default: "actual",         allowed: ["preview", "representation", "actual"] },
  // Folder-page cards — no Actual (would defeat the purpose of the grid).
  folderPage:   { default: "preview",        allowed: ["preview", "representation"] },
  // Mind-map nodes — default to the lightweight chip; user can opt into
  // preview or actual if they want a richer view.
  mindMap:      { default: "representation", allowed: ["preview", "representation", "actual"] },
  // Value-builder breadcrumb-card crumbs — rendered as Representation by
  // the helper itself, but the constant lives here for symmetry.
  valueBuilder: { default: "representation", allowed: ["representation"] },
};

/**
 * Resolve the effective view mode for an occurrence in a given placement
 * context. Pass a context tag from VIEW_MODE_CONTEXTS (default "default").
 *
 * Returns one of the three strings — never null.
 */
export function getEffectiveViewMode(occurrence, contextTag = "default") {
  const cfg = VIEW_MODE_CONTEXTS[contextTag] || VIEW_MODE_CONTEXTS.default;
  const stored = occurrence?.meta?.viewMode;
  // Stored mode wins if it's allowed in this context.
  if (stored && cfg.allowed.includes(stored)) return stored;
  // Stored mode disallowed (e.g. "actual" on a folder-page) → fall back
  // to the context default; the caller may want to persist the coercion.
  return cfg.default;
}

/**
 * Allowed modes for a context — used by the switcher to render only the
 * legal buttons.
 */
export function getAllowedViewModes(contextTag = "default") {
  return (VIEW_MODE_CONTEXTS[contextTag] || VIEW_MODE_CONTEXTS.default).allowed;
}

/**
 * Detect when a stored viewMode is illegal for the current context. The
 * caller can use this to write a coerced value back to the occurrence so
 * the next render is consistent.
 */
export function isViewModeIllegal(occurrence, contextTag = "default") {
  const stored = occurrence?.meta?.viewMode;
  if (!stored) return false;
  const cfg = VIEW_MODE_CONTEXTS[contextTag] || VIEW_MODE_CONTEXTS.default;
  return !cfg.allowed.includes(stored);
}
