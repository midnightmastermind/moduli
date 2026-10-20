// helpers/folderPages.js
// folderId -> that folder's folder-page occurrence (`meta.folderPage`, parented to the folder —
// the shape `importsFolder.ensureFolderPageOcc` mints). Cached per map identity.
const _folderPages = new WeakMap();
export function folderPageIndex(occurrencesById = {}) {
  let idx = _folderPages.get(occurrencesById);
  if (!idx) {
    idx = new Map();
    for (const o of Object.values(occurrencesById)) {
      if (o?.meta?.folderPage === true && o.parentId && !idx.has(o.parentId)) idx.set(o.parentId, o.id);
    }
    _folderPages.set(occurrencesById, idx);
  }
  return idx;
}
