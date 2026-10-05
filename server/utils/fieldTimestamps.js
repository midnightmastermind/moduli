// When a write lands, which fields count as WRITTEN? Only the ones whose value or
// flow actually changed. A client field edit sends the row's WHOLE field map, and
// bumping every field in it marked the untouched ones as freshly written too — so
// a sweep already computing a new value for one of them (Stamp Completed On,
// re-running on the Completed tick) had its write judged stale and dropped
// (client helpers/staleSweep), and a second tab editing an untouched field read
// as a conflict. Found 2026-10-05: unticking Completed left Completed On stamped
// about half the time.

const cellKey = (cell) => {
  if (cell && typeof cell === "object" && !Array.isArray(cell)) return JSON.stringify([cell.value ?? null, cell.flow ?? null]);
  return JSON.stringify([cell ?? null, null]);
};

/** The next `fieldUpdatedAt` map: `prevTs` with `nowMs` for every incoming field
 *  whose value/flow differs from `prevFields` (or that `prevFields` lacks). */
export function bumpChangedFieldTimestamps(prevFields, prevTs, incomingFields, nowMs) {
  const next = { ...(prevTs || {}) };
  for (const [fid, cell] of Object.entries(incomingFields || {})) {
    const had = prevFields && Object.prototype.hasOwnProperty.call(prevFields, fid);
    if (!had || cellKey(prevFields[fid]) !== cellKey(cell) || next[fid] == null) next[fid] = nowMs;
  }
  return next;
}
