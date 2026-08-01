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

/** Test seam. */
export function _resetForceSync() {
  token = 0;
  pending = false;
  listeners.clear();
}
