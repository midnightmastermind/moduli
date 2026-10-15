// helpers/categoryColumnSort.js
//
// Order inside a Command Center category column (Fields tab, Operations tab).
// User, 2026-10-15: "i cant reorganize them in the col at all and its not letting me
// even place them in diff columns." A field / operation carries `columnOrder` (its
// place in its column, display only — an operation's run order is `priority` then
// `sortOrder`, which this never touches). Items without one keep the order they
// arrive in, after the ordered ones.

/** The column's items in display order. Pure; never mutates. */
export function orderColumn(items = []) {
  return items
    .map((it, i) => ({ it, key: Number.isFinite(it?.columnOrder) ? it.columnOrder : 1e9 + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.it);
}

/**
 * Where the dropped item lands: `column` is the TARGET column in display order,
 * `index` the slot (0 = top, column.length or null = end). Returns the writes as
 * `[{ id, columnOrder }]` — every item whose stored order differs from its new slot,
 * plus the dragged item always (its folder may be changing even if its slot is not).
 */
export function planColumnMove({ column = [], draggedId, index = null }) {
  const rest = column.filter((it) => it.id !== draggedId);
  const at = index == null ? rest.length : Math.max(0, Math.min(index, rest.length));
  // A drop below the dragged item's own old slot in the same column shifts by one.
  const oldAt = column.findIndex((it) => it.id === draggedId);
  const slot = oldAt !== -1 && index != null && index > oldAt ? at - 1 : at;
  const ids = rest.map((it) => it.id);
  ids.splice(Math.max(0, Math.min(slot, ids.length)), 0, draggedId);
  const byId = new Map(column.map((it) => [it.id, it]));
  return ids
    .map((id, i) => ({ id, columnOrder: i }))
    .filter(({ id, columnOrder }) => id === draggedId || byId.get(id)?.columnOrder !== columnOrder);
}

/** Slot index for a drop on `targetId`'s top or bottom edge, or null (end) for the column itself. */
export function dropIndex(column = [], targetId, edge) {
  if (!targetId) return null;
  const i = column.findIndex((it) => it.id === targetId);
  if (i === -1) return null;
  return edge === "bottom" ? i + 1 : i;
}
