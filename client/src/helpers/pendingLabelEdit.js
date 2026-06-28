// helpers/pendingLabelEdit.js
// Tiny one-shot pub/sub so a just-created occurrence opens in inline label-edit
// mode (focused) the moment it mounts. The create site (QuickAddMenu "+ Item",
// InsertGap) calls requestLabelEdit(<moduleId>) right after minting; the
// matching ModuleInstance consumes it once on mount and flips into editing.
// Keyed by module id (available synchronously at every create site).
const pending = new Set();

export function requestLabelEdit(id) {
  if (id) pending.add(id);
}

// Returns true exactly once per requested id, then clears it.
export function consumeLabelEdit(id) {
  if (id && pending.has(id)) {
    pending.delete(id);
    return true;
  }
  return false;
}
