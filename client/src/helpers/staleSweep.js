// helpers/staleSweep.js
//
// A SLICED operation sweep computes against the state it started with and
// applies its effects when it finishes — seconds later on a big grid. A field
// whose value changed AFTER it began already holds a newer answer, so the
// sweep's write to that field is stale and must not land (it put a tracker back
// to the number it had before the user's edit, 2026-10-03). Everything else
// passes through untouched.
//
// ONE CLOCK. The times compared are this tab's own: when it saw a field's value
// change, against when the sweep began. It used to read the stored cell
// `timestamp` / `fieldUpdatedAt`, and the server's save ack REPLACES
// `fieldUpdatedAt` with the SERVER's clock — measured ~2s ahead of this machine
// on 2026-11-04. So a field the server had stamped a moment ago looked "written
// after" every sweep started in the next ~2s and the sweep's write was dropped:
// ticking Completed on and off left Completed On stamped with Completed off.
//
// ONLY A CHANGED VALUE COUNTS. A field edit sends the row's whole field map;
// counting every key would let an unrelated edit throw away a running sweep's
// legitimate write to another field.

const writes = new Map(); // `${occId}\u0000${fieldId}` -> ms on this tab's clock
const KEY = (occId, fieldId) => `${occId}\u0000${fieldId}`;
const PRUNE_AFTER_MS = 5 * 60_000; // far longer than any sweep runs
let lastPrune = 0;

function valueOf(cell) {
  return cell && typeof cell === "object" && !Array.isArray(cell) && "value" in cell ? cell.value : cell;
}
function flowOf(cell) {
  return cell && typeof cell === "object" && !Array.isArray(cell) ? cell.flow : undefined;
}
function same(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/**
 * Record which of `next`'s fields changed value (or flow) against `prev`.
 * `prev` without fields = a row this tab has not seen: it is ARRIVING (the deferred load chunks), not
 * changing, so nothing is recorded — a sweep cannot have computed against a value it never had.
 */
export function noteFieldWrites(occId, prev, next, now = Date.now()) {
  const nf = next?.fields;
  if (!occId || !nf || typeof nf !== "object") return;
  const pf = prev && prev.fields;
  if (!pf || typeof pf !== "object") return;
  for (const fid of Object.keys(nf)) {
    const a = pf[fid];
    const b = nf[fid];
    if (same(valueOf(a), valueOf(b)) && flowOf(a) === flowOf(b)) continue;
    writes.set(KEY(occId, fid), now);
  }
  if (now - lastPrune > PRUNE_AFTER_MS) {
    lastPrune = now;
    for (const [k, t] of writes) if (now - t > PRUNE_AFTER_MS) writes.delete(k);
  }
}

const changedSince = (occId, fieldId, t) => { const at = writes.get(KEY(occId, fieldId)); return !!(at && at > t); };

/**
 * @param {Array} updates    the sweep's updates (effects + display values)
 * @param {number} startedAt Date.now() when the sweep began (this tab's clock)
 * @param {Object} [trigger] the transaction that started the sweep. A MeasureOp whose own field has
 *   changed AGAIN since is SUPERSEDED: a newer sweep for that field computes from the new value, so
 *   every field write of this one is stale — including writes to fields it alone touches (Completed On
 *   restamped after Completed was unticked, 2026-11-04).
 */
export function dropStaleFieldWrites(updates, startedAt, trigger = null) {
  if (!Array.isArray(updates) || !startedAt) return updates;
  const tOcc = trigger?.type === "MeasureOp" ? trigger.occurrenceId : null;
  const superseded = !!tOcc && Object.keys(trigger.fields || {}).some((fid) => changedSince(tOcc, fid, startedAt));
  return updates.filter((u) => {
    if (u?._effect !== "UPDATE_ITEM_FIELD" || !u.itemId || !u.fieldId) return true;
    if (superseded) return false;
    return !changedSince(u.itemId, u.fieldId, startedAt);
  });
}

/** Tests only. */
export function _resetFieldWrites() { writes.clear(); lastPrune = 0; }
