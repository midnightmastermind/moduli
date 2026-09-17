// helpers/confirmDeleteOccurrence.js
//
// Delete a page/file the user right-clicked — confirmed, named, and through the
// ONE delete path. Shared by folder-page cards (PreviewNode) and the file-tree
// rows (ManifestTree), so "Delete" asks the same question everywhere.
//
// `CommitHelpers.deleteOccurrence` cascades what is PARENTED to the row, pulls
// the id out of every parent that lists it (so a pinned page leaves its panels
// too) and sweeps a module left with no placement.
import * as CommitHelpers from "./CommitHelpers.js";

export function deleteConfirmMessage({ occurrence, module }) {
  const kids = occurrence?.occurrences?.length || 0;
  const what = module?.label || occurrence?.label || "this item";
  return kids
    ? `Delete "${what}" and its ${kids} item${kids === 1 ? "" : "s"}?`
    : `Delete "${what}"?`;
}

/** Returns true when the delete was sent. */
export function confirmDeleteOccurrence({ occurrence, module, dispatch, socket, confirm = null }) {
  if (!occurrence?.id || !dispatch || !socket) return false;
  const ask = confirm || (typeof window !== "undefined" ? window.confirm.bind(window) : () => false);
  if (!ask(deleteConfirmMessage({ occurrence, module }))) return false;
  CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: occurrence.id, occurrence });
  return true;
}
