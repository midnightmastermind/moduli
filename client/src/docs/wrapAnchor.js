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
// RETIRED 2026-08-06 (user: "why would i want to stack at large sizes"). These
// scaled the decision by the NEIGHBOUR's height: `predicted = textArea / besideW`
// falls as the column widens, so the same text beside the same infobox read as a
// smaller and smaller fraction and the group STACKED as the panel got WIDER.
// Measured on the Eminem page — one host, one infobox, three widths:
//     beside 584 → prose 467 → 0.40 → wrapped
//     beside 1184 → prose 230 → 0.30 → STACKED
//     beside 2000 → smaller  → lower → STACKED
// CLAUDE.md 2026-07-11 recorded this same inversion in the rule these replaced
// ("width-inverted … the same text that wrapped at medium width flipped to
// stacked at large width"); the sliver rule kept the shape and only shrank the
// constant, so it inherited the bug. Kept as exports because WrapGroupNode's
// rendered blank-band guard still names WRAP_SLIVER_KEEP — see the note there.
export const WRAP_SLIVER_WRAP = 0.45;
export const WRAP_SLIVER_KEEP = 0.35;
export const WRAP_REENTER_MARGIN = 20; // px — re-entering a wrap needs a slightly wider column than holding one
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
  // WIDTH decides, and it decides the way round everyone expects: a column wide
  // enough to read gets a wrap, a column too narrow to read gets a stack.
  const floor = prevStacked ? WRAP_MIN_PROSE_W + WRAP_REENTER_MARGIN : WRAP_MIN_PROSE_W;
  if (besideW < floor) return true;                // no readable prose column at this width
  // A neighbour shorter than about a paragraph cannot leave a big blank band
  // however little text sits beside it, so one line next to a small image is a
  // caption, not a broken layout. This exemption is NOT width-scaled, which is
  // why it survived the policy change.
  if (neighborH <= WRAP_SHORT_NEIGHBOR_H) return false;
  const predicted = textArea / besideW;            // prose height if laid out in the beside column
  if (predicted < WRAP_MIN_BESIDE_H) return true;  // under ~2 lines beside the neighbor — reads broken
  return false;                                    // there is a readable column with text in it → WRAP
}

// The neighbor's height AS IT WOULD RENDER WRAPPED — the single number the
// stack/wrap decision turns on.
//
// It has to be the same number in both states or the group oscillates. Measuring
// it while WRAPPED is direct: the neighbor floats at exactly `wrapWidth`, so its
// height is the real one. While STACKED it renders FULL WIDTH, and the height at
// full width is not the height at `wrapWidth`.
//
// The old code projected it by inverse scale (`measuredH * wrapWidth /
// measuredW`), which assumes height falls as width falls — true only for a fixed
// ASPECT box like a lone image. The Wikipedia lead aside is an image stacked over
// an INFOBOX TABLE, and a table gets TALLER as it narrows: measured on the Eminem
// page at a 2482px group, stacked read 2482×1182 → projected 152 at a 320px
// float, while the real wrapped height was 757. Five times out.
//
// That gap is not a rounding error, it changes the ANSWER: 152 is under
// WRAP_SHORT_NEIGHBOR_H so the group took the short-neighbor exemption and
// wrapped; at 757 the sliver policy immediately stacked it again; and the flip
// re-fired the ResizeObserver — wrap/stack/wrap ~17ms apart, forever.
//
// So: remember the last height measured while WRAPPED and reuse it while
// stacked. The float's width does not change with the group's, so that height
// stays valid — it is a fact about the neighbor, not about the current layout.
// The projection survives only as the bootstrap for a group that has never been
// wrapped, and the memory is discarded when the float is resized to a new width.
export function resolveNeighborHeight({ stacked, measuredW, measuredH, wrapWidth, remembered = null }) {
  if (!stacked) return measuredH;
  if (remembered && remembered.wrapWidth === wrapWidth && remembered.height > 0) {
    return remembered.height;
  }
  const scale = measuredW > 0 ? wrapWidth / measuredW : 1;
  return measuredH * scale;
}
