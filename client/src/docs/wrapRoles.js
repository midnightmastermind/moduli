// docs/wrapRoles.js
// Which child of a wrapGroup does what. Pure, so the node view, the drop code,
// the menu and the delete paths all answer it the same way.
//
//   children 0 .. floatCount-1      FLOAT   — floated to `side` (any embed)
//   children floatCount .. last-1   LEAD    — text-side blocks that sit BESIDE the
//                                             float without wrapping under it
//   the last child                  HOST    — the block whose prose wraps around
//                                             the float and reclaims full width
//
// User 2026-10-01: "multiple textblocks on that side with the last one wrapping
// the elements" — a short host stopped beside a tall picture. Leads let the text
// side hold several blocks; only the last one wraps.
//
// `attrs.floatCount` null is the shape every group had before leads existed:
// every child but the last floats. So legacy groups need no migration, and a
// group only carries an explicit count once it has a lead.

/** The effective number of floated children (always 1..childCount-1 when >=2). */
export function floatCountOf(attrs, childCount) {
  const n = Number(childCount) || 0;
  if (n < 2) return Math.max(0, n - 1);
  const raw = attrs?.floatCount;
  if (raw == null || !Number.isFinite(Number(raw))) return n - 1;
  return Math.min(n - 1, Math.max(1, Math.round(Number(raw))));
}

/** "float" | "lead" | "host" for child `index`. */
export function wrapRoleAt(index, childCount, floatCount) {
  if (index >= childCount - 1) return "host";
  return index < floatCount ? "float" : "lead";
}

/** Store null when the count means what null already means (no leads). */
export function storedFloatCount(floatCount, childCount) {
  return floatCount >= childCount - 1 ? null : floatCount;
}

/**
 * The group after members at `removedIndices` leave it.
 * Returns { flatten: true } when it can no longer be a group (fewer than two
 * children, or no float left to wrap around), else { floatCount } to store.
 */
export function afterRemoval(attrs, childCount, removedIndices) {
  const removed = new Set(removedIndices);
  const left = childCount - removed.size;
  if (left < 2) return { flatten: true };
  const fc = floatCountOf(attrs, childCount);
  let floatsLeft = 0;
  for (let i = 0; i < fc; i++) if (!removed.has(i)) floatsLeft++;
  if (floatsLeft < 1) return { flatten: true };
  // A legacy group stays legacy: every survivor but the last still floats.
  if (attrs?.floatCount == null) return { floatCount: null };
  return { floatCount: storedFloatCount(Math.min(floatsLeft, left - 1), left) };
}

/** floatCount after inserting a FLOAT (at the front of the float run). */
export function afterAddingFloat(attrs, childCount) {
  if (attrs?.floatCount == null) return null;
  return floatCountOf(attrs, childCount) + 1;
}

/**
 * floatCount after inserting a TEXT-SIDE block at child index `at`
 * (floatCount <= at <= childCount). Inserting at the end makes it the new host
 * and turns the old host into a lead.
 */
export function afterAddingTextSide(attrs, childCount) {
  return floatCountOf(attrs, childCount);
}

/**
 * PURE. Did a press land in the empty band BELOW a wrap's text side and BESIDE
 * its float — the gap a short text side leaves (user 2026-10-01: *"click under
 * a wrapped textblock … and add more textblocks. right now theres just a large
 * space there that i can do nothing with"*)?
 *
 *   point       { x, y } of the press (viewport px)
 *   floatRects  the floated children's boxes
 *   textRects   the text-side children's boxes, in order
 *   groupRect   the wrap group's box
 *
 * Returns the band { left, right, top, bottom } (viewport px) or null. The band
 * runs from the last text block's bottom to the bottom of the group, across the
 * group minus the float column — so a press on the picture, on any text, or
 * past the group never counts.
 */
export function textSideGap({ point, floatRects, textRects, groupRect }) {
  if (!point || !groupRect || !floatRects?.length || !textRects?.length) return null;
  const textBottom = Math.max(...textRects.map((r) => r.bottom));
  const floatLeft = Math.min(...floatRects.map((r) => r.left));
  const floatRight = Math.max(...floatRects.map((r) => r.right));
  const floatOnRight = floatLeft - groupRect.left > groupRect.right - floatRight;
  const band = {
    top: textBottom,
    bottom: groupRect.bottom,
    left: floatOnRight ? groupRect.left : floatRight,
    right: floatOnRight ? floatLeft : groupRect.right,
  };
  if (band.bottom - band.top < 8 || band.right - band.left < 40) return null;
  const { x, y } = point;
  return x >= band.left && x <= band.right && y >= band.top && y <= band.bottom ? band : null;
}
