// state/notificationStore.js
//
// Tiny pub/sub for the transaction notification stack in the toolbar.
// Cards stay up until the user dismisses them with the × button; the
// stack renders newest-on-the-left with older cards peeking behind to
// the right (see ui/TransactionNotificationStack.jsx).

let _nextId = 1;
let _items = []; // newest first: [{ id, kind, label, createdAt }]
const _subs = new Set();

const _emit = () => {
  for (const fn of _subs) fn(_items);
};

export function pushTxNotification({ kind = "info", label }) {
  if (!label) return null;
  const id = `tx-note-${_nextId++}`;
  _items = [{ id, kind, label, createdAt: Date.now() }, ..._items];
  _emit();
  return id;
}

export function dismissTxNotification(id) {
  const next = _items.filter(n => n.id !== id);
  if (next.length === _items.length) return;
  _items = next;
  _emit();
}

export function bringTxNotificationToFront(id) {
  const idx = _items.findIndex(n => n.id === id);
  if (idx <= 0) return;
  const picked = _items[idx];
  _items = [picked, ..._items.slice(0, idx), ..._items.slice(idx + 1)];
  _emit();
}

export function subscribeTxNotifications(fn) {
  _subs.add(fn);
  fn(_items);
  return () => { _subs.delete(fn); };
}
