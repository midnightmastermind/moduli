// helpers/lastFileCopy.js
// Removing an uploaded file from a board or doc (user, 2026-10-22: "if we delete the last occurance of a file
// (outside the file tree), we should ask if we want the file deleted too").
//
// An upload is ONE occurrence filed in a Files folder (its HOME), often also listed by the board it was dropped
// on or embedded in a doc; a copy is a second occurrence of the same module. So:
//   - removing the HOME from a board/doc only takes it OFF that board/doc — it used to delete the file outright
//     (`removeOccurrence` deletes the row), which emptied Files without a word;
//   - removing a COPY deletes that copy, as before;
//   - either way, when the file is then placed nowhere outside Files, ask whether to delete the file too.
// Anything but "Delete the file" keeps it in Files.
import { askChoice } from "../ui/ChoiceDialog.jsx";
import * as CommitHelpers from "./CommitHelpers.js";
import { isUploadedFile } from "./fileHome.js";

const isFolderIn = (foldersById) => (id) => !!id && !!foldersById?.[id];

/** The file's home occurrence id (its placement in a Files folder), or null. */
export function homeOf(module, occurrencesById, foldersById) {
  if (!isUploadedFile(module)) return null;
  const isFolder = isFolderIn(foldersById);
  for (const o of Object.values(occurrencesById || {})) {
    if (o?.moduleId === module.id && isFolder(o.parentId)) return o.id;
  }
  return null;
}

/**
 * Is the file still shown anywhere OUTSIDE Files once `removingOccId` leaves `fromParentId`? Counts another
 * copy, another container listing any placement, and another doc embedding one.
 */
export function stillPlacedOutsideFiles({ module, removingOccId, fromParentId, occurrencesById, foldersById }) {
  const isFolder = isFolderIn(foldersById);
  const all = Object.values(occurrencesById || {});
  const placements = all.filter((o) => o?.moduleId === module?.id);
  const ids = new Set(placements.map((o) => o.id));
  // A placement whose parent is a folder is IN Files; there can be more than one (the server treats each as
  // the file). Any other placement — a copy on a board, a doc — is outside Files.
  const inFiles = new Set(placements.filter((o) => isFolder(o.parentId)).map((o) => o.id));
  if (placements.some((o) => o.id !== removingOccId && !inFiles.has(o.id))) return true;
  // Otherwise only a Files placement can still be listed or embedded somewhere. The parent the removed one
  // leaves no longer counts. The viewer's hidden page (`meta.spreadFor`) and a folder page list files without
  // placing them anywhere you look, so they do not count either.
  for (const o of all) {
    if (!o || ids.has(o.id) || o.meta?.spreadFor || o.meta?.folderPage || o.meta?.artifactPage) continue;
    const listed = (o.occurrences || []).filter((id) => inFiles.has(id));
    const text = o.textmap && typeof o.textmap === "object" ? JSON.stringify(o.textmap) : "";
    const embedded = [...inFiles].filter((id) => text.includes(`"occurrenceId":"${id}"`));
    for (const id of [...listed, ...embedded]) {
      if (o.id === fromParentId && id === removingOccId) continue;
      return true;
    }
  }
  return false;
}

export async function offerFileDelete({ homeId, module, occurrencesById, dispatch, socket }) {
  if (!homeId) return false;
  const name = module?.meta?.originalName || module?.label || "this file";
  const pick = await askChoice({
    title: "Delete the file too?",
    message: `"${name}" isn't placed anywhere else now. It is still in Files.`,
    choices: [
      { label: "Keep it in Files", value: "keep" },
      { label: "Delete the file", value: "delete", danger: true },
    ],
  });
  if (pick !== "delete") return false;
  CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: homeId, occurrence: occurrencesById?.[homeId] });
  return true;
}

function resolve({ occurrence, getState, getOccMap }) {
  const state = getState?.() || {};
  const occurrencesById = getOccMap?.() || {};
  const module = (state.modules || []).find((m) => m?.id === occurrence?.moduleId) || null;
  // The store keeps `folders` as an ARRAY; `foldersById` is a map App derives and the state does not carry.
  const foldersById = state.foldersById
    || Object.fromEntries((state.folders || []).filter((f) => f?.id).map((f) => [f.id, f]));
  return { module, occurrencesById, foldersById };
}

/**
 * The Delete on a row in a board/list. The home is only taken off this container; a copy is deleted. Then
 * the question, when nothing outside Files shows the file any more. Read at call time — no subscriptions.
 */
export function removeOccurrenceOfferingFile({ dispatch, socket, occurrence, parentOccurrence, getState, getOccMap }) {
  if (!occurrence?.id) return;
  const { module, occurrencesById, foldersById } = resolve({ occurrence, getState, getOccMap });
  const homeId = homeOf(module, occurrencesById, foldersById);
  // Read the live row: a placement in Files must never reach removeOccurrence, because the server deletes
  // the whole file when a Files placement is deleted.
  const live = occurrencesById[occurrence.id] || occurrence;
  const inFiles = !!homeId && !!foldersById?.[live.parentId];
  const fromParentId = parentOccurrence?.id || null;
  const ask = !!homeId && !stillPlacedOutsideFiles({ module, removingOccId: occurrence.id, fromParentId, occurrencesById, foldersById });

  if (inFiles && parentOccurrence && parentOccurrence.id !== live.parentId) {
    // Off this container only — the file stays in Files.
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: parentOccurrence.id, occurrences: (parentOccurrence.occurrences || []).filter((id) => id !== occurrence.id) },
      emit: true,
    });
  } else {
    CommitHelpers.removeOccurrence({ dispatch, socket, occurrenceId: occurrence.id, occurrence, parentOccurrence, emit: true });
  }
  if (ask) offerFileDelete({ homeId, module, occurrencesById, dispatch, socket });
}

/**
 * After a doc UNLINKED an embed of a file (the doc did not own it): ask, when nothing outside Files shows it.
 * `hostId` is the doc it left — its textmap may still hold the node until the save lands.
 */
export function offerFileDeleteAfterUnlink({ occurrence, hostId, getState, getOccMap, dispatch, socket }) {
  if (!occurrence?.id) return;
  const { module, occurrencesById, foldersById } = resolve({ occurrence, getState, getOccMap });
  const homeId = homeOf(module, occurrencesById, foldersById);
  if (!homeId) return;
  if (stillPlacedOutsideFiles({ module, removingOccId: occurrence.id, fromParentId: hostId, occurrencesById, foldersById })) return;
  offerFileDelete({ homeId, module, occurrencesById, dispatch, socket });
}
