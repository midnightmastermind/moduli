// While the app is drawing a BOOT SNAPSHOT (helpers/bootSnapshot), the grid on screen is the
// last load's copy, not the server's. The app writes nothing from it: operations / feeds / the
// scheduler / reminder sync stand down and safeEmit drops their writes. The USER can edit — those
// writes queue like offline edits (helpers/offlineQueue, helpers/queuedEdits). The real
// full_state switches it off.
let on = false;
const listeners = new Set();

export const isSnapshotMode = () => on;

export function setSnapshotMode(next) {
  next = !!next;
  if (next === on) return;
  on = next;
  for (const fn of listeners) { try { fn(on); } catch { /* a listener must not break the switch */ } }
}

export function subscribeSnapshotMode(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
