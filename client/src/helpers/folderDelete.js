// helpers/folderDelete.js — deleting a folder: what is inside moves up a level, nothing is lost.
//
// The one rule both the file tree's "Delete folder" and the headset shelf's 🗑 use. A folder's own landing page
// (a page whose module kind is "folder") goes with it — moving it up left a stray page named after the deleted
// folder (2026-10-01). Every other page/file it holds, and every folder under it, moves to the folder's parent.
// A protected folder (Templates / Files / Imports) is refused, before anything is written.
import * as CommitHelpers from "./CommitHelpers";
import { withAction } from "./actionScope";
import { isProtectedFolder } from "./protectedFolders";

const isFolderPage = (occ, modulesById) => {
  const m = modulesById?.[occ?.moduleId];
  return m?.role === "page" && m?.kind === "folder";
};

/** What deleting `folder` does. Pure. Null when it may not be deleted. */
export function planFolderDelete(folder, { occurrencesById, foldersById, modulesById }) {
  if (!folder?.id || isProtectedFolder(folder)) return null;
  const occs = Object.values(occurrencesById || {}).filter((o) => o?.parentId === folder.id);
  return {
    deleteOccIds: occs.filter((o) => isFolderPage(o, modulesById)).map((o) => o.id),
    moveOccIds: occs.filter((o) => !isFolderPage(o, modulesById)).map((o) => o.id),
    moveFolderIds: Object.values(foldersById || {}).filter((f) => f?.parentId === folder.id).map((f) => f.id),
    parentId: folder.parentId || null,
  };
}

/** Delete `folder`, moving its contents up. Returns false when refused. One undo step. */
export function deleteFolderMoveUp({ dispatch, socket, folder, occurrencesById, foldersById, modulesById }) {
  const plan = planFolderDelete(folder, { occurrencesById, foldersById, modulesById });
  if (!plan) return false;
  withAction("Deleted folder", () => {
    for (const id of plan.deleteOccIds) CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: id, occurrence: occurrencesById[id] });
    for (const id of plan.moveOccIds) CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id, parentId: plan.parentId }, emit: true });
    for (const id of plan.moveFolderIds) CommitHelpers.updateFolder({ dispatch, socket, folder: { id, parentId: plan.parentId }, emit: true });
    CommitHelpers.deleteFolder({ dispatch, socket, folderId: folder.id, emit: true });
  });
  return true;
}
