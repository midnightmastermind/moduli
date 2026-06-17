// bspTree.js — pure binary-split-tree (BSP / "mosaic") layout helpers.
//
// A mosaic grid stores its layout as a tree at `grid.meta.layoutTree`:
//
//   Leaf  = { id, panelOccId }                       // a pane = ONE panel occurrence
//   Split = { id, dir: "v" | "h", ratio: number[], children: Node[] }
//
//   dir:"v" → a VERTICAL splitter bar → children laid out LEFT→RIGHT (columns)
//   dir:"h" → a HORIZONTAL splitter bar → children TOP→BOTTOM (rows)
//   ratio[i] = fr weight of child i (length === children.length); normalized at
//   compute time (mirrors the grid's colSizes/rowSizes fr convention so the
//   existing resize-drag math is reused).
//
// Every function here is PURE and immutable — no React, no sockets, no DOM —
// so the whole module is unit-testable in isolation.

const MIN_RATIO = 0.05; // a pane can't be dragged below 5% of its split

function newId(prefix = "n") {
  const rnd =
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    Math.random().toString(36).slice(2);
  return `${prefix}-${rnd}`;
}

export function isLeaf(node) {
  return !!node && !Array.isArray(node.children);
}

export function makeLeaf(panelOccId, id) {
  return { id: id || newId("leaf"), panelOccId };
}

export function makeSplit(dir, children, ratio, id) {
  return {
    id: id || newId("split"),
    dir,
    children,
    ratio: ratio && ratio.length === children.length ? ratio.slice() : children.map(() => 1),
  };
}

// ---------------------------------------------------------------------------
// Derive an initial tree from the existing rows×cols panel placements.
// Column-major: group visible panels by placement.col, sort columns left→right;
// within each column sort panels top→bottom. Top level is a "v" split over the
// columns; each column is an "h" split over its panels (a bare leaf when one).
//
// `panels` is the visiblePanels shape from Grid.jsx: each entry has
// `_occurrenceId`, `row`, `col`, and an optional `layout.style.display`.
// Ratios start equal — the user re-tunes after converting. Best-effort for
// non-sliceable ("pinwheel") layouts; column-major is correct for any layout
// whose panels don't straddle a column boundary (the seed's does not).
// ---------------------------------------------------------------------------
export function deriveTreeFromPlacements(panels) {
  const visible = (panels || []).filter(
    (p) => p && p._occurrenceId && (p?.layout?.style?.display ?? "block") !== "none"
  );
  if (visible.length === 0) return null;

  // One panel per (row,col) cell — keep the first visible (mirrors Grid.jsx's
  // per-cell visible-panel pick; stacked/hidden panels are omitted from the
  // derived tree).
  const seenCell = new Set();
  const byCol = new Map();
  for (const p of visible) {
    const row = p.row ?? 0;
    const col = p.col ?? 0;
    const cellKey = `${row}:${col}`;
    if (seenCell.has(cellKey)) continue;
    seenCell.add(cellKey);
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col).push({ row, occId: p._occurrenceId });
  }

  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const columnNodes = cols.map((col) => {
    const cellsInCol = byCol.get(col).sort((a, b) => a.row - b.row);
    const leaves = cellsInCol.map((c) => makeLeaf(c.occId));
    return leaves.length === 1 ? leaves[0] : makeSplit("h", leaves);
  });

  return columnNodes.length === 1 ? columnNodes[0] : makeSplit("v", columnNodes);
}

// ---------------------------------------------------------------------------
// Compute pixel rects for every pane + every splitter bar, given the tree and
// an outer rect. `splitterThickness` is the hit/visual band centered on each
// internal divider.
//   → { panes: [{ panelOccId, leafId, rect }],
//       splitters: [{ id, splitId, index, dir, rect }] }
//   rect = { x, y, w, h }
// ---------------------------------------------------------------------------
export function computeLayout(tree, rect, splitterThickness = 6) {
  const panes = [];
  const splitters = [];
  if (!tree || !rect) return { panes, splitters };
  const T = splitterThickness;

  function walk(node, r) {
    if (isLeaf(node)) {
      panes.push({ panelOccId: node.panelOccId, leafId: node.id, rect: { ...r } });
      return;
    }
    const total = node.ratio.reduce((a, b) => a + b, 0) || node.children.length;
    const horizontal = node.dir === "v"; // "v" splitter → divide along X (columns)
    let cursor = horizontal ? r.x : r.y;
    const extent = horizontal ? r.w : r.h;

    node.children.forEach((child, i) => {
      const frac = (node.ratio[i] ?? 1) / total;
      const size = extent * frac;
      const childRect = horizontal
        ? { x: cursor, y: r.y, w: size, h: r.h }
        : { x: r.x, y: cursor, w: r.w, h: size };
      walk(child, childRect);
      cursor += size;
      // Splitter sits on the boundary AFTER this child (between i and i+1).
      if (i < node.children.length - 1) {
        const boundary = cursor;
        splitters.push({
          id: `${node.id}:${i}`,
          splitId: node.id,
          index: i,
          dir: node.dir,
          // axisExtentPx + ratioTotal let a drag convert pixel delta → fr delta:
          //   frDelta = (pixelDelta / axisExtentPx) * ratioTotal
          axisExtentPx: extent,
          ratioTotal: total,
          rect: horizontal
            ? { x: boundary - T / 2, y: r.y, w: T, h: r.h }
            : { x: r.x, y: boundary - T / 2, w: r.w, h: T },
        });
      }
    });
  }

  walk(tree, rect);
  return { panes, splitters };
}

// ---------------------------------------------------------------------------
// Resize: shift `frDelta` (in fr units, relative to the split's ratio total)
// from child `dividerIndex+1` to child `dividerIndex`. Conserves the pair sum,
// clamps each side to MIN_RATIO. Immutable — returns a new tree.
// ---------------------------------------------------------------------------
export function resizeSplit(tree, splitId, dividerIndex, frDelta) {
  if (!tree) return tree;
  if (isLeaf(tree)) return tree;

  if (tree.id === splitId) {
    const i = dividerIndex;
    if (i < 0 || i + 1 >= tree.children.length) return tree;
    const pairSum = tree.ratio[i] + tree.ratio[i + 1];
    let a = tree.ratio[i] + frDelta;
    let b = pairSum - a;
    if (a < MIN_RATIO) { a = MIN_RATIO; b = pairSum - MIN_RATIO; }
    if (b < MIN_RATIO) { b = MIN_RATIO; a = pairSum - MIN_RATIO; }
    const ratio = tree.ratio.slice();
    ratio[i] = a;
    ratio[i + 1] = b;
    return { ...tree, ratio };
  }

  let changed = false;
  const children = tree.children.map((c) => {
    const rc = resizeSplit(c, splitId, dividerIndex, frDelta);
    if (rc !== c) changed = true;
    return rc;
  });
  return changed ? { ...tree, children } : tree;
}

// ---------------------------------------------------------------------------
// Split the leaf `leafId` along `dir`, placing a new pane for `newPanelOccId`
// beside it (`before` controls which side). If the leaf's parent split already
// has the same `dir`, the new pane is inserted as a SIBLING (flatten, no extra
// nesting); otherwise the leaf is WRAPPED in a fresh split. Immutable.
// ---------------------------------------------------------------------------
export function splitLeaf(tree, leafId, dir, newPanelOccId, before = false) {
  if (!tree) return tree;
  const newLeaf = makeLeaf(newPanelOccId);

  if (isLeaf(tree)) {
    if (tree.id !== leafId) return tree;
    return makeSplit(dir, before ? [newLeaf, tree] : [tree, newLeaf]);
  }

  let changed = false;
  const children = [];
  const ratio = [];
  tree.children.forEach((c, i) => {
    if (isLeaf(c) && c.id === leafId) {
      changed = true;
      const r = tree.ratio[i];
      if (tree.dir === dir) {
        // flatten — insert sibling, split the leaf's weight evenly
        if (before) { children.push(newLeaf, c); } else { children.push(c, newLeaf); }
        ratio.push(r / 2, r / 2);
      } else {
        // wrap the leaf in a perpendicular split
        children.push(makeSplit(dir, before ? [newLeaf, c] : [c, newLeaf]));
        ratio.push(r);
      }
    } else {
      const rc = splitLeaf(c, leafId, dir, newPanelOccId, before);
      if (rc !== c) changed = true;
      children.push(rc);
      ratio.push(tree.ratio[i]);
    }
  });
  return changed ? { ...tree, children, ratio } : tree;
}

// ---------------------------------------------------------------------------
// Remove the pane for `panelOccId`. Single-child splits collapse upward (the
// remaining child takes the parent's place). Returns the new tree, or null if
// the removed pane was the last one. Immutable.
// ---------------------------------------------------------------------------
export function removeLeaf(tree, panelOccId) {
  if (!tree) return null;
  if (isLeaf(tree)) return tree.panelOccId === panelOccId ? null : tree;

  const children = [];
  const ratio = [];
  tree.children.forEach((c, i) => {
    const rc = removeLeaf(c, panelOccId);
    if (rc === null) return; // dropped
    children.push(rc);
    ratio.push(tree.ratio[i]);
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]; // collapse single child
  return { ...tree, children, ratio };
}

export function allPanelOccIds(tree) {
  const out = [];
  (function walk(n) {
    if (!n) return;
    if (isLeaf(n)) { out.push(n.panelOccId); return; }
    n.children.forEach(walk);
  })(tree);
  return out;
}

export function findLeaf(tree, panelOccId) {
  let found = null;
  (function walk(n) {
    if (!n || found) return;
    if (isLeaf(n)) { if (n.panelOccId === panelOccId) found = n; return; }
    n.children.forEach(walk);
  })(tree);
  return found;
}
