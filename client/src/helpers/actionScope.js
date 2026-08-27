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
// Writes with no action open carry no id and are recorded as `derived` — the
// undo stack skips them. That USED to describe the load sweep, the scheduler
// and feed sync by accident, and stopped being true once every write helper
// opened an action of its own: a page load was measured writing 26 undo steps.
// They are explicit now — see `runDerived`.

let currentActionId = null;
let currentLabel = null;
let depth = 0;
// > 0 while a DERIVED scope is running — see `runDerived`.
let derivedDepth = 0;
let autoCloseTimer = null;
// Actions with DEFERRED work still to come, by id, with an outstanding count.
// See `captureAction` below for why the close signal has to wait on these.
const retained = new Map();

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
  // A derived scope never opens an action. Without this the load sweep's own
  // writes each open one, and `derived = !actionId` (server/utils/txRecorder.js)
  // then records every one of them as an undo step.
  if (derivedDepth > 0) return null;
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
  if (derivedDepth > 0) return;
  if (depth > 0) depth -= 1;
  if (depth === 0) forceEndAction();
}

export function forceEndAction() {
  const closed = currentActionId;
  currentActionId = null;
  currentLabel = null;
  depth = 0;
  if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
  // Tell the server this action is complete so it can flush the buffer instead
  // of waiting out its 1500ms idle timer. Without this the transaction is not
  // undoable until 1.5s after the write, so a quick Ctrl+Z targeted the
  // PREVIOUS one. Never let a hook throw unwind the scope reset above.
  // NOT while deferred work is still pending: the server flushes this action's
  // buffer on the signal, and anything arriving afterwards would start a SECOND
  // transaction. `releaseAction` sends it when the last continuation drains.
  if (closed && closeHook && !retained.has(closed)) {
    try { closeHook(closed); } catch { /* the scope is already closed; a failed signal only costs latency */ }
  }
}

// Wired by bindSocketToStore (the only layer that owns a socket).
let closeHook = null;
export function setActionCloseHook(fn) { closeHook = typeof fn === "function" ? fn : null; }

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

// ── DEFERRED CONTINUATIONS OF THE SAME ACTION ──────────────────────────────
//
// `withAction` is SYNCHRONOUS: it closes in a `finally`. But a field write
// defers its operation cascade past the paint (2026-08-25 (7)), so every write
// that cascade makes lands after the scope has shut and opens an action of its
// own. Measured on the live grid: one checkbox toggle produced 40-54
// transactions across **201 distinct action ids, one document each** — so
// Ctrl+Z undid the last derived write instead of the thing the user did, which
// is why undo appeared not to work at all.
//
// This is the same omission the fire deferral already fixed for `_fireDepth`,
// and for the same reason: ambient scope does not survive a task boundary
// unless it is carried. Depth was carried; the action id was not.
//
// A NEW GESTURE IS STILL ITS OWN ACTION, which is what stops this swallowing
// unrelated work: between continuations the ambient id is null, so `beginAction`
// mints a fresh one. Only the continuations themselves re-enter the old id.

// ── WRITES WITH NO USER BEHIND THEM ────────────────────────────────────────
//
// The load sweep, the scheduler and feed sync are the app recomputing itself.
// Their writes must not be undo steps: `derived = !actionId`, and every write
// helper opens its own action, so each recomputation became one.
//
// MEASURED ON THE LIVE GRID — a page load with NOTHING clicked, twice, the
// second immediately after the first with nothing changed in between:
//
//                              load A    load B
//   transactions written         55        52
//   ON THE UNDO STACK            29        26     <- Ctrl+Z pops one of these
//   derived                       0         0
//   distinct action ids          29        26
//   docs per transaction          1         1
//   occurrences touched           6         2     -> the tracker tiles
//
// So after any reload Ctrl+Z reverted a tracker recomputation instead of the
// last thing the user did. Load B is the control: a second load on a settled
// grid still writes 26, so this is not the sweep catching up on stale state.
//
// This is ADDITIVE on purpose. Suppressing an action can only ever move a
// write OFF the stack, so a site that forgets the scope keeps today's noise;
// the inverse design — undoable only inside an explicit gesture — fails the
// other way, silently making a real edit un-undoable, which reads as data loss.
// `derivedNoUndoStep.test.js` fails if a load sweep produces an action id.

/** Run `fn` as the app's own bookkeeping: its writes carry no action id. */
export function runDerived(fn) {
  derivedDepth += 1;
  const prevId = currentActionId, prevLabel = currentLabel, prevDepth = depth;
  currentActionId = null;
  currentLabel = null;
  depth = 0;
  try {
    return fn();
  } finally {
    derivedDepth -= 1;
    currentActionId = prevId;
    currentLabel = prevLabel;
    depth = prevDepth;
  }
}

/** True while the app is writing on its own behalf. */
export function isDerived() {
  return derivedDepth > 0;
}

/** Snapshot the ambient action so a deferred continuation can re-enter it. */
export function captureAction() {
  // A derived scope has to be carried across a deferral for exactly the reason
  // the action id does: the load sweep defers its cascade past the paint, so
  // without this the continuation runs at derivedDepth 0 and every write it
  // makes opens an action again — the guard would cover only the synchronous
  // half of the very sweep it was written for.
  if (derivedDepth > 0) return { derived: true };
  return currentActionId ? { id: currentActionId, label: currentLabel } : null;
}

/** Hold the close signal: this action has work that has not run yet. */
export function retainAction(captured) {
  if (!captured?.id) return;
  retained.set(captured.id, (retained.get(captured.id) || 0) + 1);
}

/** One continuation finished. The last one out sends the close signal. */
export function releaseAction(captured) {
  const id = captured?.id;
  if (!id) return;
  const n = (retained.get(id) || 0) - 1;
  if (n > 0) { retained.set(id, n); return; }
  retained.delete(id);
  if (closeHook) {
    try { closeHook(id); } catch { /* a failed signal only costs latency */ }
  }
}

/**
 * Run `fn` with `captured` as the ambient action, then restore what was there.
 * Deliberately does NOT touch the auto-close timer or fire the close hook — it
 * is re-entering an action, not opening one.
 */
export function runInAction(captured, fn) {
  if (captured?.derived) return runDerived(fn);
  if (!captured?.id) return fn();
  const prevId = currentActionId, prevLabel = currentLabel, prevDepth = depth;
  currentActionId = captured.id;
  currentLabel = captured.label;
  depth = 1;
  try {
    return fn();
  } finally {
    currentActionId = prevId;
    currentLabel = prevLabel;
    depth = prevDepth;
  }
}

/** Test seam. */
export function _resetActionScope() {
  closeHook = null;
  retained.clear();
  derivedDepth = 0;
  forceEndAction();
}
