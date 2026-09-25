// state/notificationStore.js
//
// Tiny pub/sub for the transaction notification stack in the toolbar.
// This is the ONE notification surface in the app — the toolbar pill
// stack (see ui/TransactionNotificationStack.jsx). The `toast` export
// below is a sonner-compatible adapter so every existing `toast.*` call
// site renders as a pill instead of a separate sonner toast.
//
// TWO layers, one store:
//   • Inline toolbar stack — the active (undismissed) pills. The × on a
//     pill (and the toast-style auto-dismiss `duration`) marks it
//     `dismissed` → it leaves the stack.
//   • Dropdown — a PERSISTENT log of everything ever pushed (dismissed or
//     not). Notifications never leave the dropdown; the store is capped at
//     MAX_HISTORY so it can't grow unbounded.
// Transaction-style pills (field changed, op success/failure) push with no
// `duration` and stay in the stack until ×'d. Toast-style pills pass a
// `duration` and auto-dismiss FROM THE STACK; `toast.loading` persists until
// a follow-up `toast.*(msg, { id })` updates it in place.

const MAX_HISTORY = 100;

let _nextId = 1;
let _items = []; // newest first: [{ id, kind, label, createdAt, dismissed }]
const _subs = new Set();
const _timers = new Map(); // id -> setTimeout handle (auto-dismiss)

const _emit = () => {
  for (const fn of _subs) fn(_items);
};

function _clearTimer(id) {
  const t = _timers.get(id);
  if (t) {
    clearTimeout(t);
    _timers.delete(id);
  }
}

function _scheduleDismiss(id, duration) {
  _clearTimer(id);
  if (typeof duration === "number" && duration > 0) {
    _timers.set(id, setTimeout(() => dismissTxNotification(id), duration));
  }
}

// Push a new pill, OR update an existing one in place when `id` matches a
// live pill (sonner's `{ id }` progress-update pattern). `duration` (ms)
// auto-dismisses; omit/null to keep the pill until manual dismiss.
export function pushTxNotification({ kind = "info", label, id = null, duration = null }) {
  if (!label) return null;

  if (id != null && _items.some(n => n.id === id)) {
    _items = _items.map(n => (n.id === id ? { ...n, kind, label } : n));
    _emit();
    _scheduleDismiss(id, duration);
    return id;
  }

  const newId = id != null ? id : `tx-note-${_nextId++}`;
  _items = [{ id: newId, kind, label, createdAt: Date.now(), dismissed: false }, ..._items];
  if (_items.length > MAX_HISTORY) _items = _items.slice(0, MAX_HISTORY);
  _emit();
  _scheduleDismiss(newId, duration);
  return newId;
}

// Dismiss = remove from the INLINE toolbar stack only (mark `dismissed`).
// The notification STAYS in the dropdown log. Called by the pill's × and by
// the toast-style auto-dismiss timer.
export function dismissTxNotification(id) {
  _clearTimer(id);
  let changed = false;
  _items = _items.map(n => {
    if (n.id === id && !n.dismissed) { changed = true; return { ...n, dismissed: true }; }
    return n;
  });
  if (changed) _emit();
}


// ---------------------------------------------------------------------------
// GESTURE PILLS — the notification stack IS the change history (2026-09-25).
//
// The separate transaction-history panel is gone: its per-row Undo restored a
// whole `before` snapshot out of order, erasing later edits. Everything a user
// gesture writes shares one `actionId` (helpers/actionScope), so each gesture
// is ONE pill here, however many rows it and the operations it set off wrote:
// the first readable field change names it, the rest count as "+N updates".
//
// Only the pill holding the newest undoable transaction offers Undo — the same
// step Ctrl+Z takes, and the only one the server will accept (undo_transaction
// refuses anything but the stack top). Operation writes with no gesture behind
// them are never pills with Undo.
//
// Session-only by design (user: "dont let it survive reload").
// ---------------------------------------------------------------------------
let _undoTopId = null;
let _undoHandler = null;

export function upsertGesturePill({
  actionId, gridId = null, label = null, fallbackLabel = null,
  transactionId = null, touchedIds = [], bump = 0,
}) {
  if (!actionId) return null;
  const id = `gesture:${actionId}`;
  const existing = _items.find(n => n.id === id);
  if (existing) {
    _items = _items.map(n => {
      if (n.id !== id) return n;
      const touched = new Set([...(n.touchedIds || []), ...touchedIds]);
      const readable = n.readable || !!label;
      return {
        ...n,
        label: n.readable ? n.label : (label || n.label),
        readable,
        // A write that finally NAMES the gesture replaces the fallback label
        // and is not itself counted as an extra update.
        extra: (n.extra || 0) + (!n.readable && label ? 0 : bump),
        transactionId: transactionId || n.transactionId,
        touchedIds: [...touched],
      };
    });
    _emit();
    return id;
  }
  const text = label || fallbackLabel;
  if (!text) return null;
  _items = [{
    id, kind: "success", label: text, readable: !!label, extra: 0,
    createdAt: Date.now(), dismissed: false,
    gesture: true, actionId, gridId, transactionId, touchedIds: [...touchedIds], state: "applied",
  }, ..._items];
  if (_items.length > MAX_HISTORY) _items = _items.slice(0, MAX_HISTORY);
  _emit();
  return id;
}

export function markTransactionUndone(transactionId) {
  if (!transactionId) return;
  let changed = false;
  _items = _items.map(n => {
    if (n.transactionId !== transactionId || n.state === "undone") return n;
    changed = true;
    return { ...n, state: "undone" };
  });
  if (changed) _emit();
}

/** The transaction the next undo would take back (from the server's undo_state). */
export function setUndoTop(transactionId, handler) {
  const next = transactionId || null;
  if (handler !== undefined) _undoHandler = handler;
  if (next === _undoTopId) return;
  _undoTopId = next;
  _emit();
}

export function getUndoTop() { return _undoTopId; }

/** A pill can undo only when it holds the stack top and has not been undone. */
export function canUndoPill(note) {
  return !!(note?.gesture && note.transactionId && note.state !== "undone" && note.transactionId === _undoTopId);
}

export function undoPill(note) {
  if (!canUndoPill(note) || !_undoHandler) return false;
  _undoHandler(note.transactionId);
  return true;
}

/** "Drink Water · Done: false → true · +3 updates" */
export function gesturePillText(note) {
  if (!note?.gesture) return note?.label || "";
  const extra = note.extra > 0 ? ` · +${note.extra} update${note.extra === 1 ? "" : "s"}` : "";
  return `${note.label}${extra}${note.state === "undone" ? " — undone" : ""}`;
}

export function subscribeTxNotifications(fn) {
  _subs.add(fn);
  fn(_items);
  return () => { _subs.delete(fn); };
}

// ---------------------------------------------------------------------------
// sonner-compatible `toast` adapter — backed by the pill store above.
// Default 4s auto-dismiss for transient toasts; `loading` persists (no
// duration) until a follow-up call with the same `{ id }` updates it.
// ---------------------------------------------------------------------------
const DEFAULT_TOAST_DURATION = 4000;

function _toast(kind, defaultDuration) {
  return (label, opts = {}) => {
    const text = opts.description ? `${label} — ${opts.description}` : label;
    const duration = "duration" in opts ? opts.duration : defaultDuration;
    return pushTxNotification({ kind, label: text, id: opts.id ?? null, duration });
  };
}

export const toast = Object.assign(_toast("info", DEFAULT_TOAST_DURATION), {
  success: _toast("success", DEFAULT_TOAST_DURATION),
  error:   _toast("error", DEFAULT_TOAST_DURATION),
  info:    _toast("info", DEFAULT_TOAST_DURATION),
  message: _toast("info", DEFAULT_TOAST_DURATION),
  warning: _toast("warning", DEFAULT_TOAST_DURATION),
  loading: _toast("pending", null), // persists until updated via { id }
  dismiss: (id) => dismissTxNotification(id),
});
