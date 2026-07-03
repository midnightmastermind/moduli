// helpers/gridSnap.js
// Windows-style panel snapping for rows×cols grids (2026-07-03, per user:
// "press some button plus the arrow keys to add new grid cells, move the last
// clicked grid panel to that new cell … the exact thing as the Windows one").
//
// Two entry points sharing the same move/grow primitives:
//   snapPanelInDirection — keyboard (Ctrl+Alt+Arrow): move the panel one cell
//     in a direction; hitting the grid boundary GROWS the grid by one track
//     in that direction; landing on another panel's anchor cell SWAPS them.
//   snapPanelToEdge — touch drag (tablet landscape): dropping a panel on an
//     outer edge band grows the grid at that edge and places the panel in the
//     new track, keeping its perpendicular position.
//
// GROW moves leave the vacated cell empty on purpose — that's the free slot
// for the next panel. IN-BOUNDS moves compact afterwards: any row/column left
// with no panel at all is removed (placements shift to close the gap), so
// snapping a panel back also SHRINKS the grid instead of accumulating empty
// tracks. Minimum 1×1. The rows/cols inputs in Grid settings compact too.
import * as CommitHelpers from "./CommitHelpers";

const DIRS = {
  up: { dr: -1, dc: 0, axis: "row" },
  down: { dr: 1, dc: 0, axis: "row" },
  left: { dr: 0, dc: -1, axis: "col" },
  right: { dr: 0, dc: 1, axis: "col" },
};

function placementOf(occ) {
  const p = occ?.placement || {};
  return { row: p.row ?? 0, col: p.col ?? 0, width: p.width ?? 1, height: p.height ?? 1 };
}

function commitPlacement({ dispatch, socket, occ, row, col }) {
  CommitHelpers.updateOccurrence({
    dispatch, socket,
    occurrence: { id: occ.id, placement: { ...(occ.placement || {}), row, col } },
    emit: true,
  });
}

// All panel occurrences on the grid (placement-carrying occurrences whose id
// is in grid.occurrences). Caller passes occurrencesById + grid.
function panelOccsOf(grid, occurrencesById) {
  return (grid?.occurrences || [])
    .map((id) => occurrencesById?.[id])
    .filter((o) => o && o.placement);
}

// Grow the grid by one track on `axis`. Growing at the START shifts every
// panel's anchor +1 on that axis so existing panels keep their cells.
function growGrid({ dispatch, socket, grid, occurrencesById, axis, atStart }) {
  const gridId = grid._id || grid.id;
  const dims = axis === "row" ? { rows: (grid.rows ?? 1) + 1 } : { cols: (grid.cols ?? 1) + 1 };
  if (atStart) {
    for (const occ of panelOccsOf(grid, occurrencesById)) {
      const p = placementOf(occ);
      commitPlacement({
        dispatch, socket, occ,
        row: axis === "row" ? p.row + 1 : p.row,
        col: axis === "col" ? p.col + 1 : p.col,
      });
    }
  }
  CommitHelpers.updateGrid({ dispatch, socket, gridId, grid: dims, emit: true });
  return dims;
}

// Remove every row/column that no panel covers (anchor..anchor+span-1),
// shifting placements to close the gaps. `overrides` supplies just-committed
// placements the render-time occurrencesById snapshot doesn't reflect yet
// (the panel that snapped this tick, or a swap partner).
function compactEmptyTracks({ dispatch, socket, grid, occurrencesById, overrides = {} }) {
  const rows = grid.rows ?? 1;
  const cols = grid.cols ?? 1;
  const occs = panelOccsOf(grid, occurrencesById);
  const place = (o) => {
    const p = placementOf(o);
    return overrides[o.id] ? { ...p, ...overrides[o.id] } : p;
  };
  const usedRows = new Set();
  const usedCols = new Set();
  for (const o of occs) {
    const p = place(o);
    for (let r = p.row; r < p.row + p.height; r++) usedRows.add(r);
    for (let c = p.col; c < p.col + p.width; c++) usedCols.add(c);
  }
  const keptRows = [...Array(rows).keys()].filter((r) => usedRows.has(r));
  const keptCols = [...Array(cols).keys()].filter((c) => usedCols.has(c));
  const nRows = Math.max(1, keptRows.length);
  const nCols = Math.max(1, keptCols.length);
  if (nRows === rows && nCols === cols) return false;
  const rowRank = {};
  keptRows.forEach((r, i) => { rowRank[r] = i; });
  const colRank = {};
  keptCols.forEach((c, i) => { colRank[c] = i; });
  for (const o of occs) {
    const p = place(o);
    const nr = rowRank[p.row] ?? p.row;
    const nc = colRank[p.col] ?? p.col;
    // Re-commit when the rank shifted the anchor; the overridden (just-moved)
    // panel was already committed by the caller at its pre-rank position.
    if (nr !== p.row || nc !== p.col) {
      commitPlacement({ dispatch, socket, occ: o, row: nr, col: nc });
    }
  }
  CommitHelpers.updateGrid({
    dispatch, socket, gridId: grid._id || grid.id,
    grid: { rows: nRows, cols: nCols }, emit: true,
  });
  return true;
}

/**
 * Keyboard snap. Returns true when it did something.
 */
export function snapPanelInDirection({ direction, panelOcc, grid, occurrencesById, dispatch, socket }) {
  const d = DIRS[direction];
  if (!d || !panelOcc || !grid) return false;
  const rows = grid.rows ?? 1;
  const cols = grid.cols ?? 1;
  const p = placementOf(panelOcc);
  let targetRow = p.row + d.dr;
  let targetCol = p.col + d.dc;

  const pastStart = targetRow < 0 || targetCol < 0;
  // A multi-span panel's far edge decides when moving down/right needs growth.
  const pastEnd =
    (d.dr > 0 && p.row + p.height + d.dr > rows) ||
    (d.dc > 0 && p.col + p.width + d.dc > cols);

  if (pastStart || pastEnd) {
    growGrid({ dispatch, socket, grid, occurrencesById, axis: d.axis, atStart: pastStart });
    if (pastStart) {
      // Everything (incl. this panel) shifted +1; the new track is index 0.
      targetRow = d.dr < 0 ? 0 : p.row + (d.axis === "row" ? 1 : 0);
      targetCol = d.dc < 0 ? 0 : p.col + (d.axis === "col" ? 1 : 0);
    }
    commitPlacement({ dispatch, socket, occ: panelOcc, row: targetRow, col: targetCol });
    return true;
  }

  // In-bounds move. Exact-anchor occupant → swap (Windows-ish predictability).
  const occupant = panelOccsOf(grid, occurrencesById).find((o) => {
    if (o.id === panelOcc.id) return false;
    const op = placementOf(o);
    return op.row === targetRow && op.col === targetCol;
  });
  const overrides = { [panelOcc.id]: { row: targetRow, col: targetCol } };
  if (occupant) {
    commitPlacement({ dispatch, socket, occ: occupant, row: p.row, col: p.col });
    overrides[occupant.id] = { row: p.row, col: p.col };
  }
  commitPlacement({ dispatch, socket, occ: panelOcc, row: targetRow, col: targetCol });
  // In-bounds moves SHRINK: if the vacated track (or any other) is now fully
  // empty, compact it away. Grow moves above skip this — their empty track is
  // the intended free cell.
  compactEmptyTracks({ dispatch, socket, grid, occurrencesById, overrides });
  return true;
}

/**
 * Drag-to-edge snap (touch). Grows the grid at `edge` and places the panel in
 * the new track at its current perpendicular index (clamped).
 */
export function snapPanelToEdge({ edge, panelOcc, grid, occurrencesById, dispatch, socket }) {
  const d = DIRS[edge];
  if (!d || !panelOcc || !grid) return false;
  const p = placementOf(panelOcc);
  const atStart = d.dr < 0 || d.dc < 0;
  growGrid({ dispatch, socket, grid, occurrencesById, axis: d.axis, atStart });
  if (d.axis === "row") {
    const newRow = atStart ? 0 : (grid.rows ?? 1); // grown by one below/above
    const col = atStart ? p.col : p.col; // perpendicular position kept
    commitPlacement({ dispatch, socket, occ: panelOcc, row: newRow, col });
  } else {
    const newCol = atStart ? 0 : (grid.cols ?? 1);
    commitPlacement({ dispatch, socket, occ: panelOcc, row: p.row, col: newCol });
  }
  return true;
}
