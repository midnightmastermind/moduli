// helpers/folderDeletePlan.js — what deleting a folder does (pure; the write is helpers/folderDelete). Its own file so
// the server can plan it with the app's code (vr/officeCore.js) without loading the socket client.
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

