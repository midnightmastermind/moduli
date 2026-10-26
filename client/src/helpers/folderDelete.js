// helpers/folderDelete.js — deleting a folder: what is inside moves up a level, nothing is lost.
//
// The one rule both the file tree's "Delete folder" and the headset shelf's 🗑 use. A folder's own landing page
// (a page whose module kind is "folder") goes with it — moving it up left a stray page named after the deleted
// folder (2026-10-01). Every other page/file it holds, and every folder under it, moves to the folder's parent.
// A protected folder (Templates / Files / Imports) is refused, before anything is written.
import * as CommitHelpers from "./CommitHelpers";
import { withAction } from "./actionScope";
import { planFolderDelete } from "./folderDeletePlan";
export { planFolderDelete } from "./folderDeletePlan";

/** Delete `folder`, moving its contents up. Returns false when refused. One undo step. */
export function deleteFolderMoveUp({ dispatch, socket, folder, occurrencesById, foldersById, modulesById, plan: given = undefined }) {
  // `plan`: worked out elsewhere (the headset's control panel holds no grid; the server plans it).
  const plan = given !== undefined ? given : planFolderDelete(folder, { occurrencesById, foldersById, modulesById });
  if (!plan) return false;
  withAction("Deleted folder", () => {
    for (const id of plan.deleteOccIds) CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: id, occurrence: occurrencesById?.[id] });
    for (const id of plan.moveOccIds) CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id, parentId: plan.parentId }, emit: true });
    for (const id of plan.moveFolderIds) CommitHelpers.updateFolder({ dispatch, socket, folder: { id, parentId: plan.parentId }, emit: true });
    CommitHelpers.deleteFolder({ dispatch, socket, folderId: folder.id, emit: true });
  });
  return true;
}
