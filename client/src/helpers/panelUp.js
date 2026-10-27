// helpers/panelUp.js
// Where the panel's "Up one level" button goes from the page it shows (user, 2026-10-27:
// "a move up one level button … that allows me to traverse up the ancestory"):
//   - a page inside a container on another page -> that page (nearest page above it);
//   - a page filed in a folder -> that folder's folder page;
//   - a folder page -> the folder page of the folder above.
// Returns { id } (a page to open) or { folderId } (a folder whose folder page does not exist yet —
// they are minted the first time a folder is opened), or null when there is nowhere to go.
import { folderPageIndex } from "./folderPages";

export function upTarget(occId, { occurrencesById = {}, modulesById = {}, foldersById = {} } = {}) {
  const occ = occurrencesById[occId];
  if (!occ) return null;
  const pages = folderPageIndex(occurrencesById);
  if (occ.meta?.folderPage) {
    const folder = foldersById[occ.parentId];
    return folder?.parentId ? toFolder(folder.parentId, pages) : null;
  }
  const seen = new Set([occ.id]);
  let cur = occ;
  while (cur?.parentId && !seen.has(cur.parentId)) {
    const pid = cur.parentId;
    seen.add(pid);
    const p = occurrencesById[pid];
    if (!p) return foldersById[pid] ? toFolder(pid, pages) : null;
    if (p.meta?.folderPage || modulesById[p.moduleId]?.role === "page") return { id: p.id };
    cur = p;
  }
  return null;
}

function toFolder(folderId, pages) {
  const id = pages.get(folderId);
  return id ? { id } : { folderId };
}
