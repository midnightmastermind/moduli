// state/activeCellStore.js
// ============================================================
// Subscription store for the mobile viewport's active cell + zoomed-out flag.
//
// WHY: `activeCell` lived in App state and rode GridLiveContext's memo, so every
// rail tap minted a new context value and re-rendered EVERY consumer — the whole
// grid, including all ~97 instance rows. On a Samsung A15 that main-thread work
// is the "hot second" before the destination cell paints. The slider transform
// itself was already fixed (2026-07-27: painted imperatively in the tap's own
// frame, measured at 0.9ms) — the re-render was the half nobody removed, and a
// desktop probe could not feel it.
//
// This is the exact remedy the comment above `activeCell` in App.jsx already
// describes for computedValues ("Riding on GridLiveContext meant every swap
// re-rendered every consumer"), and the same one GridActionsContext got on
// 2026-07-07. Only the handful of components that actually read the cell
// subscribe; instance rows never see it.
//
// Like computedValuesStore this is a render fan-out layer, NOT a second source
// of record: App.jsx still owns the state (it persists to localStorage and
// restores per grid) and publishes here.
// ============================================================
import { useSyncExternalStore } from "react";

let _cell = { row: 0, col: 0 };
let _zoomedOut = false;
const _listeners = new Set();

function emit() {
  for (const l of _listeners) l();
}

function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Publish the active cell. No-ops when unchanged BY VALUE — MobileGridNav
 *  hands a fresh `{row,col}` object on every render, so an identity check
 *  would wake every subscriber on each one. */
// The store OWNS the value now — App no longer holds it in useState. Keeping it
// there meant every rail tap re-rendered App by definition, and App is the root:
// its own render plus the second pass this store triggers in Grid is the ~450ms
// block measured on 2026-08-04. The render counters read zero only because App
// and Grid carry none — an absent signal, not a measurement of zero, which is
// the same mistake the Firefox longtask reading produced earlier that day.
let _gridId = null;

/** Point the store at a grid and restore that grid's saved cell. Imperative on
 *  purpose: App must not re-render for navigation state. */
export function initActiveCellForGrid(gridId, rows = 1, cols = 1) {
  _gridId = gridId || null;
  let next = { row: 0, col: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem("moduli-activeCell-" + gridId));
    if (saved && typeof saved.row === "number" && typeof saved.col === "number") {
      next = { row: Math.min(saved.row, rows - 1), col: Math.min(saved.col, cols - 1) };
    }
  } catch { /* corrupt entry — fall back to the origin cell */ }
  _cell = next;
  _zoomedOut = false;
  emit();
}

/** THE setter. Accepts a value or an updater, like the useState it replaces, so
 *  call sites (MobileGridNav's back-to-back taps compose via the updater form)
 *  did not have to change. Persists as a side effect. */
export function setActiveCell(next) {
  const value = typeof next === "function" ? next(_cell) : next;
  if (!value) return;
  if (_cell.row === value.row && _cell.col === value.col) return;
  _cell = { row: value.row, col: value.col };
  if (_gridId) {
    try { localStorage.setItem("moduli-activeCell-" + _gridId, JSON.stringify(_cell)); }
    catch { /* private mode / quota — navigation still works */ }
  }
  emit();
}

export function setZoomedOut(next) {
  const value = typeof next === "function" ? next(_zoomedOut) : next;
  publishZoomedOut(value);
}

export function publishActiveCell(cell) {
  const next = cell || { row: 0, col: 0 };
  if (_cell.row === next.row && _cell.col === next.col) return;
  _cell = next;
  emit();
}

export function publishZoomedOut(v) {
  const next = !!v;
  if (_zoomedOut === next) return;
  _zoomedOut = next;
  emit();
}

/** Non-reactive reads, for event handlers and refs that must not subscribe
 *  (DragProvider's edge-nav reads the cell mid-drag from a ref, and must not
 *  re-register its listeners when it changes). */
export function getActiveCell() { return _cell; }
export function getZoomedOut() { return _zoomedOut; }

/** Snapshot is the cell OBJECT, whose identity only changes on a real move,
 *  so React bails on every unrelated publish. */
export function useActiveCell() {
  return useSyncExternalStore(subscribe, getActiveCell);
}

export function useZoomedOut() {
  return useSyncExternalStore(subscribe, getZoomedOut);
}
