// ============================================================
// Windows-style region snapping for the Mosaic (BSP) layout.
//
// THE SIBLING OF `helpers/gridSnap.js`, which is this same policy for rows×cols
// grids. `bspTree.js` stays split-tree MATH; "what does right mean" is policy
// and lives here.
//
// A panel's region is DERIVED from the tree, never stored. Stored region state
// would drift the moment someone drags a seam, and the arrows would then act on
// a state that no longer matches what is on screen.
//
// Spec: docs/superpowers/specs/2026-09-04-mosaic-snap-design.md
// ============================================================
import { findLeaf, isLeaf, makeLeaf, makeSplit, removeLeaf } from "./bspTree";

/**
 * Where does this panel sit, in half/quadrant terms?
 *
 * This RECOGNISES the shapes `snapLeaf` produces and calls everything else
 * `full`. That is deliberate: a panel wedged as a middle child of a three-way
 * split is not on either edge, and claiming an edge would make the next arrow
 * press move it somewhere the user did not predict.
 *
 * Only the outer two levels are inspected, because that is the deepest shape a
 * snap ever builds (a quadrant is a split inside a split).
 */
export function regionOf(tree, panelOccId) {
  if (!tree || !panelOccId) return null;
  if (!findLeaf(tree, panelOccId)) return null;

  let col = "full";
  let row = "full";
  let node = tree;

  for (let depth = 0; depth < 2 && node && !isLeaf(node); depth++) {
    const idx = node.children.findIndex((c) => !!findLeaf(c, panelOccId));
    if (idx === -1) break;
    const first = idx === 0;
    const last = idx === node.children.length - 1;
    // An edge child of a two-way split IS a half. A middle child of three is on
    // neither edge and stays `full` — which is what `!last` / `!first` buy.
    // (`first && last` is a one-child split, a shape `removeLeaf` collapses.)
    if (node.dir === "v" && col === "full") {
      if (first && !last) col = "left";
      else if (last && !first) col = "right";
    } else if (node.dir === "h" && row === "full") {
      if (first && !last) row = "top";
      else if (last && !first) row = "bottom";
    }
    node = node.children[idx];
  }
  return { col, row };
}

const AXIS = { left: "col", right: "col", up: "row", down: "row" };
const EDGE = { left: "left", right: "right", up: "top", down: "bottom" };
const OPPOSITE = { left: "right", right: "left", top: "bottom", bottom: "top" };

/**
 * Snap a panel one step in `direction`. Returns a NEW tree, or null when
 * nothing changed.
 *
 * Left/Right always SET the column — one press crosses you to the other side.
 * Up/Down set the row, except that pressing the arrow opposite your current row
 * RELEASES it back to full — and only from a QUADRANT. From a plain top half
 * there is no column constraint to fall back on, so releasing would leave the
 * panel with no region and the press would read as broken.
 */
export function snapLeaf(tree, panelOccId, direction) {
  const axis = AXIS[direction];
  if (!axis) return null;

  const cur = regionOf(tree, panelOccId);
  if (!cur) return null;

  const edge = EDGE[direction];
  if (cur[axis] === edge) return null;             // already there

  const next = { ...cur };
  const inQuadrant = cur.col !== "full" && cur.row !== "full";
  if (axis === "row" && inQuadrant && cur.row === OPPOSITE[edge]) {
    next.row = "full";                             // release
  } else {
    next[axis] = edge;
  }

  const rest = removeLeaf(tree, panelOccId);
  if (!rest) return null;                          // the tree was just this leaf
  return buildRegion(rest, makeLeaf(panelOccId), next);
}

/** Place `leaf` in `region` with `rest` filling the complement. */
function buildRegion(rest, leaf, { col, row }) {
  if (row === "full") {
    return col === "right" ? makeSplit("v", [rest, leaf])
                           : makeSplit("v", [leaf, rest]);
  }
  if (col === "full") {
    return row === "bottom" ? makeSplit("h", [rest, leaf])
                            : makeSplit("h", [leaf, rest]);
  }
  // QUADRANT. The complement's own top-level split supplies the partition,
  // WHICHEVER WAY IT SPLITS: the part on our side becomes our neighbour and the
  // remainder takes the other side. Nothing is invented.
  //
  // A complement that is a single LEAF is the one irreducible case: putting us
  // in a quadrant would wrap it around us in an L, and a BSP tree cannot say
  // that. Then, and only then, we degrade and nothing moves.
  if (isLeaf(rest) || rest.children.length < 2) return null;

  if (rest.dir === "h") {
    // ROWS. Pair with the row on our side; the remaining rows span the width.
    const takeFirst = row === "top";
    const mate = takeFirst ? rest.children[0] : rest.children[rest.children.length - 1];
    const others = takeFirst ? rest.children.slice(1) : rest.children.slice(0, -1);
    const otherRatio = takeFirst ? rest.ratio.slice(1) : rest.ratio.slice(0, -1);
    const otherRow = others.length === 1 ? others[0] : makeSplit("h", others, otherRatio);

    const myRow = col === "right" ? makeSplit("v", [mate, leaf])
                                  : makeSplit("v", [leaf, mate]);
    return takeFirst ? makeSplit("h", [myRow, otherRow])
                     : makeSplit("h", [otherRow, myRow]);
  }

  // COLUMNS — the mirror image, and the half this originally missed. Pair with
  // the column on OUR side and split that column by row; the remaining columns
  // keep their FULL HEIGHT. That is what makes "bottom panel, press Right" turn
  // the top-left pane into a full-height left column instead of doing nothing
  // (user, 2026-09-04 — the complement of a full-width bottom panel is exactly
  // this shape, so the row-only form degraded on the most ordinary layout there
  // is).
  const takeFirstCol = col === "left";
  const mateCol = takeFirstCol ? rest.children[0] : rest.children[rest.children.length - 1];
  const otherCols = takeFirstCol ? rest.children.slice(1) : rest.children.slice(0, -1);
  const otherColRatio = takeFirstCol ? rest.ratio.slice(1) : rest.ratio.slice(0, -1);
  const otherCol = otherCols.length === 1 ? otherCols[0] : makeSplit("v", otherCols, otherColRatio);

  const myCol = row === "bottom" ? makeSplit("h", [mateCol, leaf])
                                 : makeSplit("h", [leaf, mateCol]);
  return takeFirstCol ? makeSplit("v", [myCol, otherCol])
                      : makeSplit("v", [otherCol, myCol]);
}

/**
 * Which snap does a drop at (x, y) mean? Null means "not in the perimeter" —
 * the drop belongs to whichever pane is under the pointer, which is the gesture
 * that builds nested layouts and must keep working.
 *
 * Each side is three zones: the middle third is the half, the outer thirds are
 * the quadrants. A corner is inside two bands, and both resolve to the same
 * quadrant, so the overlap needs no tie-break.
 */
export function zoneAt({ x, y, w, h, band = 48 }) {
  const nearLeft = x <= band;
  const nearRight = x >= w - band;
  const nearTop = y <= band;
  const nearBottom = y >= h - band;
  if (!nearLeft && !nearRight && !nearTop && !nearBottom) return null;

  const third = (v, extent) => (v < extent / 3 ? "start" : v > (2 * extent) / 3 ? "end" : "middle");

  if (nearLeft || nearRight) {
    const direction = nearLeft ? "left" : "right";
    const t = third(y, h);
    return { direction, quadrant: t === "start" ? "up" : t === "end" ? "down" : null };
  }
  const direction = nearTop ? "up" : "down";
  const t = third(x, w);
  return { direction, quadrant: t === "start" ? "left" : t === "end" ? "right" : null };
}

/**
 * Set a panel's region OUTRIGHT. Returns a new tree, or null when nothing
 * changed (already there, unknown panel, or a quadrant the complement cannot
 * supply — the same degrade rule `snapLeaf` obeys, since both go through
 * `buildRegion`).
 *
 * THE DIFFERENCE FROM `snapLeaf` IS THE GESTURE, NOT THE MATH. An arrow is
 * RELATIVE — pressing the arrow opposite your current row releases it, which is
 * what makes Down-then-Down feel right on a keyboard. A pointer is ABSOLUTE: a
 * drop on the top-right corner names the top-right quadrant, and composing it
 * out of two presses would hit that release rule and hand back a half instead
 * (measured on the live grid, 2026-09-04).
 */
export function snapLeafToRegion(tree, panelOccId, region) {
  const cur = regionOf(tree, panelOccId);
  if (!cur || !region) return null;
  const want = { col: region.col || "full", row: region.row || "full" };
  if (cur.col === want.col && cur.row === want.row) return null;   // already there

  const rest = removeLeaf(tree, panelOccId);
  if (!rest) return null;                          // the tree was just this leaf
  return buildRegion(rest, makeLeaf(panelOccId), want);
}

/**
 * The region a perimeter zone names. A side's middle third is that side's half;
 * its end thirds are the two quadrants on that side — and a corner, which is in
 * two bands at once, maps to the same region from either.
 */
export function regionForZone(zone) {
  if (!zone) return null;
  const { direction, quadrant } = zone;
  if (direction === "left" || direction === "right") {
    return { col: direction, row: quadrant === "up" ? "top" : quadrant === "down" ? "bottom" : "full" };
  }
  const row = direction === "up" ? "top" : "bottom";
  return { col: quadrant === "left" || quadrant === "right" ? quadrant : "full", row };
}
