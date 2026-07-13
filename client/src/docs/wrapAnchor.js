// client/src/docs/wrapAnchor.js
// Pure geometry helpers for the line-level wrap anchor. No DOM/React -- so they're
// unit-testable; the Editor/WrapGroupNode call them with measured numbers.

// The "can this module morph around a neighbor" rule: only a TEXTMAPPED module
// (role:"textblock" OR a kind:"doc" container) hosts a wrap — never a
// board/list/table. THE single source for Editor's drop gate and the
// wrapGroup radial toggle.
export function isTextmappedModule(mod) {
  if (!mod) return false;
  return mod.role === "textblock" || (mod.role === "container" && mod.kind === "doc");
}

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

// ── Wrap-vs-stack decision (user policy 2026-07-11) ──────────────────────────
// "Stack ONLY when the beside band is blank or holds just a small amount of
// text; bigger widths must keep wrapping." Replaces the 2026-07-10
// all-or-nothing fill rule (predicted prose height >= 100% of the neighbor),
// which made WIDER panels stack (widening shrinks predicted height, so the
// same text that wrapped at medium width flipped to stacked at large width)
// and let SHRINKING panels stay wrapped down to an unreadable 60px column.
export const WRAP_MIN_PROSE_W = 160;    // px — a prose column thinner than this is shredded words → stack
export const WRAP_SLIVER_WRAP = 0.45;   // stacked → wrap when predicted beside-prose ≥ neighborH × this
export const WRAP_SLIVER_KEEP = 0.35;   // wrapped → stack once it drops below neighborH × this
export const WRAP_MIN_BESIDE_H = 44;    // px — under ~2 text lines beside the neighbor always reads broken
export const WRAP_SHORT_NEIGHBOR_H = 280; // px — a neighbor shorter than ~a paragraph can never leave the
                                          // tall empty band the sliver rule exists for → always wrap
                                          // (only the narrow-column floor still stacks it)

// Pure decision: should the group STACK (true) instead of wrapping?
//   textArea  — summed area of the host's text line boxes (layout-invariant)
//   besideW   — prose column width beside the floated neighbor
//   neighborH — the neighbor union box height
//   prevStacked — current mode, for hysteresis (entry threshold > exit threshold)
export function decideWrapStack({ textArea, besideW, neighborH, prevStacked = false }) {
  if (!textArea) return true;                      // blank host — nothing to wrap
  if (besideW < WRAP_MIN_PROSE_W) return true;     // no readable prose column at this width
  if (neighborH <= WRAP_SHORT_NEIGHBOR_H) return false; // short neighbor: magazine float, always fine
  const predicted = textArea / besideW;            // prose height if laid out in the beside column
  if (predicted < WRAP_MIN_BESIDE_H) return true;  // under ~2 lines beside the neighbor
  const frac = prevStacked ? WRAP_SLIVER_WRAP : WRAP_SLIVER_KEEP;
  return predicted < neighborH * frac;             // only a sliver of the band would hold text
}
