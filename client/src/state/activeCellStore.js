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
