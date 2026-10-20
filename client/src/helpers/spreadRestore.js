// helpers/spreadRestore.js
//
// The viewer (artifact spread) comes back after a reload (user 2026-10-20: "could you also have the
// viewer persist between reloads"). What is remembered is only WHICH viewer was open — the owner
// occurrence, the panel it docked to, the maximized tile — per grid, in this browser. The arrangement
// itself (board/canvas, tile order, canvas x/y) already lives on the viewer's own page in the grid.
// localStorage is right here: it is a per-device convenience, and every read/write is guarded so a
// private window or blocked storage just means "nothing to restore".
const keyFor = (gridId) => `moduli-open-viewer:${gridId}`;

export function readOpenSpread(gridId) {
  if (!gridId) return null;
  try {
    const raw = localStorage.getItem(keyFor(gridId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v.occurrenceId === "string" && v.occurrenceId ? v : null;
  } catch { return null; }
}

export function saveOpenSpread(gridId, { occurrenceId, panelId = null, maxId = null } = {}) {
  if (!gridId || !occurrenceId) return;
  try { localStorage.setItem(keyFor(gridId), JSON.stringify({ occurrenceId, panelId, maxId })); } catch { /* storage blocked */ }
}

export function clearOpenSpread(gridId) {
  if (!gridId) return;
  try { localStorage.removeItem(keyFor(gridId)); } catch { /* storage blocked */ }
}
