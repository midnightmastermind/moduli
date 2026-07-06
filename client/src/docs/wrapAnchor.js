// client/src/docs/wrapAnchor.js
// Pure geometry helpers for the line-level wrap anchor. No DOM/React -- so they're
// unit-testable; the Editor/WrapGroupNode call them with measured numbers.

// Which side the neighbor floats to, from the horizontal fraction across the host.
// No dead "middle third" -- every drop picks a side (split at the midline) so a drop
// anywhere over the host forms/keeps a wrap (fixes "drop in the middle = no wrap").
export function sideFromFrac(frac) {
  return frac < 0.5 ? "left" : "right";
}

// The float's margin-top (px from the host prose top) for a drop at `dropY`.
// When `lineTops` (prose-relative tops of each visual line) is supplied, snap to the
// nearest line top AT OR ABOVE the drop, so the neighbor starts cleanly on a line.
export function anchorOffsetForDrop({ dropY, hostProseTop, lineTops = null }) {
  const raw = Math.max(0, Math.round(dropY - hostProseTop));
  if (!Array.isArray(lineTops) || lineTops.length === 0) return raw;
  let snapped = 0;
  for (const t of lineTops) { if (t <= raw) snapped = t; else break; }
  return snapped;
}

// Whether the wrap anchors BELOW the host top (middle/bottom shape family).
// Line-level nodes carry `anchorOffset` (px — authoritative when present);
// legacy nodes only carry `anchorIndex` (host block index).
export function hasMidAnchor({ anchorIndex, anchorOffset }) {
  if (anchorOffset != null && Number.isFinite(Number(anchorOffset))) return Number(anchorOffset) > 0;
  return (Number(anchorIndex) || 0) > 0;
}

// Classify the measured wrap shape from the anchor + measured boxes:
//   top    — notch at the very top corner (prose beside + full width below)
//   middle — prose full-width ABOVE and BELOW the neighbor
//   bottom — neighbor reaches the host bottom (no prose below → upside-down L)
export function classifyWrapShape({ anchorIndex, anchorOffset, neighborBottom, hostBottom, threshold = 24 }) {
  if (!hasMidAnchor({ anchorIndex, anchorOffset })) return "top";
  return hostBottom - neighborBottom < threshold ? "bottom" : "middle";
}
