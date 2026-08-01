// helpers/actionScope.js
//
// Groups ONE user action with every write its operation cascade produces, so
// undo is a single step.
//
// The problem this solves: dropping a task into a schedule slot moves the
// occurrence, stamps Date + Time Slot, and then fires ~40 tracker writes. If
// each of those is its own undo step, Ctrl+Z is useless — you press it forty
// times, and stopping halfway leaves the trackers disagreeing with the data.
//
// How it works: a user gesture opens an action; `safeEmit`
// (helpers/offlineQueue.js) stamps `__actionId` on every outbound socket write
// while one is open; the server buffers all writes sharing that id into ONE
// transaction (server/utils/txRecorder.js).
//
// Writes with no action open (the scheduler, feed sync) carry no id and are
// recorded as `derived` — the undo stack skips them.

let currentActionId = null;
let currentLabel = null;
let depth = 0;
let autoCloseTimer = null;

// Backstop. An action is normally closed when the op cascade drains, but a
// throw between begin and end must not leave it open — every later write would
// then be swallowed into a stale action and undo would revert far too much.
const MAX_ACTION_MS = 4000;

function mintId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Open an action (or join the one already open — nested gestures share it).
 * @returns the action id.
 */
export function beginAction(label = null) {
  depth += 1;
  if (!currentActionId) {
    currentActionId = mintId();
    currentLabel = label;
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => { forceEndAction(); }, MAX_ACTION_MS);
  } else if (!currentLabel && label) {
    currentLabel = label;
  }
  return currentActionId;
}

/** Close the innermost scope; the action ends when the outermost one closes. */
export function endAction() {
  if (depth > 0) depth -= 1;
  if (depth === 0) forceEndAction();
}

export function forceEndAction() {
  currentActionId = null;
  currentLabel = null;
  depth = 0;
  if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
}

export function getActionId() {
  return currentActionId;
}

export function getActionLabel() {
  return currentLabel;
}

/**
 * Run `fn` inside an action. The action stays open until the operation cascade
 * that `fn` triggers has drained — callers that fire ops should close it from
 * the drain hook instead of relying on this returning.
 */
export function withAction(label, fn) {
  beginAction(label);
  try {
    return fn();
  } finally {
    endAction();
  }
}

/** Test seam. */
export function _resetActionScope() {
  forceEndAction();
}
