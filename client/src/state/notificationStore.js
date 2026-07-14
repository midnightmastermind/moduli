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
