// helpers/staleSweep.js
//
// A SLICED operation sweep computes against the state it started with and
// applies its effects when it finishes — seconds later on a big grid. A field
// written AFTER it began already holds a newer answer, so the sweep's write to
// that field is stale and must not land (it put a tracker back to the number
// it had before the user's edit). Everything else passes through untouched.

/** Field timestamp of the stored cell, or null. */
function writtenAt(occ, fieldId) {
  const cell = occ?.fields?.[fieldId];
  const ts = cell && typeof cell === "object" ? cell.timestamp : null;
  const local = occ?.fieldUpdatedAt?.[fieldId];
  const best = Math.max(Number(ts) || 0, Number(local) || 0);
  return best || null;
}

/**
 * @param {Array} updates     the sweep's updates (effects + display values)
 * @param {Object} occsById   the current overlay-merged occurrences
 * @param {number} startedAt  Date.now() when the sweep began
 */
export function dropStaleFieldWrites(updates, occsById, startedAt) {
  if (!Array.isArray(updates) || !startedAt) return updates;
  return updates.filter((u) => {
    if (u?._effect !== "UPDATE_ITEM_FIELD" || !u.itemId || !u.fieldId) return true;
    const at = writtenAt(occsById?.[u.itemId], u.fieldId);
    return !(at && at > startedAt);
  });
}
