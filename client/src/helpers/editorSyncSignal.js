// helpers/editorSyncSignal.js
//
// Lets undo/redo push content INTO a mounted editor that would otherwise
// refuse it.
//
// `ui/Editor.jsx`'s content-sync effect deliberately ignores incoming content
// when the editor has focus, was clicked in the last moment, or was typed in
// within the last 3s (`locallyModifiedRef`). Those guards exist so a stale
// debounced echo can't reset the doc under the user's caret — and they are
// right for echoes.
//
// An undo is NOT an echo. It is an explicit user command, and it necessarily
// arrives while the editor has focus and was just typed in — so every guard
// fires and the revert never reaches the screen. The database and the store
// were correct; the editor just kept showing the old text, and the next
// keystroke saved that stale text straight back over the restored value
// (user 2026-08-01: "its not undoing new textblocks or typing").
//
// Flow: the server emits `sync_state` after applying an undo → the client
// marks a force pending and re-requests full state → when that state lands,
// the token bumps and every mounted editor syncs ONCE, guards bypassed.

let token = 0;
let pending = false;
const listeners = new Set();

/** Called when an undo/redo has been applied server-side. */
export function requestForceSync() {
  pending = true;
}

/** Called once the replacement state has actually arrived. */
export function commitForceSync() {
  if (!pending) return;
  pending = false;
  token += 1;
  for (const fn of listeners) {
    try { fn(); } catch { /* a bad subscriber must not block the rest */ }
  }
}

export function subscribeForceSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getForceSyncToken() {
  return token;
}

// ── AN OPERATION'S WRITE TO ONE EDITOR ─────────────────────────────────────
//
// An op that rewrites a textmap is not an echo either — and it is usually
// CAUSED by a click inside that very editor. The Emotions Wheel is a node view
// inside the day column's editor, so clicking a slice focuses the column and
// marks it just-clicked; the Mood op's embed of the new Check In then arrived
// under both guards and was dropped until a reload (user, 2026-09-19: "the
// checkins are still not showing up until after i reload").
//
// Scoped to ONE occurrence, unlike the undo force above, and it lifts only the
// focus and just-clicked guards — never the typed-recently guard, so an op
// cannot overwrite prose the user has not saved yet.
//
// A MARK WITH A DEADLINE, not a one-shot token: the store update and this
// signal can render in separate passes, and a one-shot consumed on the pass
// that still holds the OLD content would drop the bypass before the new
// content arrives. The editor clears the mark only once it has applied a
// change.
const OP_WRITE_TTL_MS = 3000;
const opWrites = new Map();          // occurrenceId -> expires-at (ms)
let opToken = 0;
const opListeners = new Set();

export function markOperationWrite(occurrenceId, now = Date.now()) {
  if (!occurrenceId) return;
  opWrites.set(occurrenceId, now + OP_WRITE_TTL_MS);
  opToken += 1;
  for (const fn of opListeners) {
    try { fn(); } catch { /* a bad subscriber must not block the rest */ }
  }
}

export function hasOperationWrite(occurrenceId, now = Date.now()) {
  const until = occurrenceId ? opWrites.get(occurrenceId) : undefined;
  if (!until) return false;
  if (now > until) { opWrites.delete(occurrenceId); return false; }
  return true;
}

export function clearOperationWrite(occurrenceId) {
  opWrites.delete(occurrenceId);
}

export function subscribeOperationWrite(fn) {
  opListeners.add(fn);
  return () => opListeners.delete(fn);
}

export function getOperationWriteToken() {
  return opToken;
}

/** Test seam. */
export function _resetForceSync() {
  token = 0;
  pending = false;
  listeners.clear();
  opWrites.clear();
  opToken = 0;
  opListeners.clear();
}
