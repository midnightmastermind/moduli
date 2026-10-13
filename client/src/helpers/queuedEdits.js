// Edits made while the grid was a boot snapshot (or offline) are queued, and the real full_state
// does not contain them. Applied onto the payload BEFORE it is dispatched, the screen keeps what
// the user did, and the load sweep computes trackers from it. The queue is still flushed to the
// server afterwards (helpers/offlineQueue) — this only keeps the local copy honest.
//
// Pure: returns a new payload, never mutates the one passed in.
export function applyQueuedEditsToPayload(payload, entries = []) {
  if (!payload || !entries.length) return payload;
  let occs = null, mods = null;
  const occList = () => (occs ||= [...(payload.occurrences || [])]);
  const modList = () => (mods ||= [...(payload.modules || [])]);
  const idx = (list, id) => list.findIndex((x) => x?.id === id);

  for (const { event, data } of entries) {
    if (!data) continue;
    if (event === "update_occurrence" && data.occurrence?.id) {
      const list = occList(); const i = idx(list, data.occurrence.id);
      if (i >= 0) list[i] = { ...list[i], ...stripMeta(data.occurrence) };
    } else if (event === "create_occurrence" && data.occurrence?.id) {
      const list = occList();
      if (idx(list, data.occurrence.id) < 0) list.push(stripMeta(data.occurrence));
    } else if (event === "delete_occurrence" && data.occurrenceId) {
      const list = occList(); const i = idx(list, data.occurrenceId);
      if (i >= 0) list.splice(i, 1);
    } else if (event === "create_module" && data.module?.id) {
      const list = modList();
      if (idx(list, data.module.id) < 0) list.push(stripMeta(data.module));
    } else if (event === "update_module" && data.module?.id) {
      const list = modList(); const i = idx(list, data.module.id);
      if (i >= 0) list[i] = { ...list[i], ...stripMeta(data.module) };
    }
  }
  if (!occs && !mods) return payload;
  return { ...payload, ...(occs ? { occurrences: occs } : {}), ...(mods ? { modules: mods } : {}) };
}

// Wire-only keys that ride on a queued payload and are not part of the row.
function stripMeta(row) {
  const { __actionId, __actionLabel, insertAtIndex, textmapBasis, expectedUpdatedAt, ...rest } = row || {};
  return rest;
}
