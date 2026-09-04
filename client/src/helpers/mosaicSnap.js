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
import { findLeaf, isLeaf } from "./bspTree";

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
