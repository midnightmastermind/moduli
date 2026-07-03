// helpers/layoutRules.js
// Per-grid responsive layout rules (grid.meta.layoutRules) — the user decides
// which layout renders at which viewport size instead of relying only on the
// built-in isMobileLayout heuristic (2026-07-03, per user: "we should make it
// so we can set what layout gets used in the same place we can set the col and
// row … add min and max width and height and setting what layout it gets").
//
// Rule shape (all bounds optional; missing bound = unbounded):
//   { id, minWidth?, maxWidth?, minHeight?, maxHeight?, layout: "desktop" | "mobile" }
//
// Resolution: FIRST rule whose every declared bound matches the viewport wins.
// No rules / no match → null (caller falls back to the built-in heuristic).

export const LAYOUT_MODES = [
  { value: "desktop", label: "Desktop grid" },
  { value: "mobile", label: "Mobile stack" },
];

function boundOk(value, min, max) {
  if (min != null && min !== "" && value < Number(min)) return false;
  if (max != null && max !== "" && value > Number(max)) return false;
  return true;
}

export function resolveLayoutMode(rules, viewport) {
  if (!Array.isArray(rules) || rules.length === 0 || !viewport) return null;
  const { width, height } = viewport;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  for (const r of rules) {
    if (!r || (r.layout !== "desktop" && r.layout !== "mobile")) continue;
    if (!boundOk(width, r.minWidth, r.maxWidth)) continue;
    if (!boundOk(height, r.minHeight, r.maxHeight)) continue;
    return r.layout;
  }
  return null;
}
