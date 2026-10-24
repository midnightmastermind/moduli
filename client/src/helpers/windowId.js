// helpers/windowId.js — this window's id: a drag names the window it started in, so another window can tell it apart
// and a cross-grid MOVE can be finished by the window that holds the original. No imports: the socket code reads it,
// and the drag module (which needs a browser to load) re-exports it.
let _windowId = null;
export function getWindowId() {
  if (!_windowId) {
    _windowId = globalThis.crypto?.randomUUID?.() || `win-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return _windowId;
}
