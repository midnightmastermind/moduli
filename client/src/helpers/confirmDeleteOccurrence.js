// helpers/confirmDeleteOccurrence.js
//
// THE delete for a page, file or book — every surface goes through `deleteOccurrenceEverywhere`, so deleting a page
// from its radial menu, the file tree, a folder-page card or a shelf in the headset is ONE thing (user, 2026-10-24:
// "make sure that delete book and delete page are synced"). `CommitHelpers.deleteOccurrence` cascades what is
// PARENTED to the row, pulls the id out of every parent that lists it (so a pinned page leaves ALL its panels),
// records the undo step, takes its embeds out of docs and sweeps a module left with no placement.
//
// The question is asked in the app's own dialog (`askChoice`), not window.confirm: a headset panel never shows a web
// confirm, so Delete there did nothing. The headset shelf asks with its own two taps and calls the delete directly.
import * as CommitHelpers from "./CommitHelpers.js";
import { occurrenceDisplayLabel } from "./occurrenceLabel.js";
import { askChoice } from "../ui/ChoiceDialog.jsx";

export function deleteConfirmMessage({ occurrence, module }) {
  const kids = occurrence?.occurrences?.length || 0;
  const what = occurrenceDisplayLabel(occurrence, module, "this item");
  return kids
    ? `Delete "${what}" and its ${kids} item${kids === 1 ? "" : "s"}?`
    : `Delete "${what}"?`;
}

/** Delete without asking (the caller has asked). False when there is nothing to delete. */
export function deleteOccurrenceEverywhere({ occurrence, dispatch, socket }) {
  if (!occurrence?.id || !dispatch || !socket) return false;
  CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: occurrence.id, occurrence });
  return true;
}

/** Ask, then delete. Resolves true when the delete was sent. `confirm(message)` may return a boolean or a Promise. */
export async function confirmDeleteOccurrence({ occurrence, module, dispatch, socket, confirm = null }) {
  if (!occurrence?.id || !dispatch || !socket) return false;
  const message = deleteConfirmMessage({ occurrence, module });
  const ok = confirm
    ? await confirm(message)
    : (await askChoice({ title: message, choices: [{ value: "delete", label: "Delete", danger: true }] })) === "delete";
  if (!ok) return false;
  return deleteOccurrenceEverywhere({ occurrence, dispatch, socket });
}
