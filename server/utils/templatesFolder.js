// server/utils/templatesFolder.js
//
// WHERE templates live. Location is the ONLY marker of "this is a template":
// the children of the one protected "Templates" folder under the user manifest.
// There is no templates manifest, no meta.templateName, and no
// module.meta.templateModule — see
// docs/superpowers/specs/2026-08-02-template-editing-design.md
//
// Mirrors the client's helpers/templateHelpers.js templatesFolderFor() so both
// ends agree on what counts as the templates folder.
import { TEMPLATES_FOLDER_NAME, isProtectedFolder } from "./protectedFolders.js";

// Paranoia guard: a corrupt folder chain must not spin the walk forever.
const MAX_FOLDER_DEPTH = 16;

/** The protected Templates folder for this user+grid, or null. */
export function findTemplatesFolder(uc, { gridId, userId }) {
  return Object.values(uc?.foldersById || {}).find(
    f => f
      && f.gridId === gridId
      && f.userId === userId
      && isProtectedFolder(f)
      && f.name === TEMPLATES_FOLDER_NAME,
  ) || null;
}

/**
 * Resolve the folder a template write should land in.
 *
 * No `parentFolderId` → the Templates folder itself. With one → that folder,
 * but ONLY when it sits inside the Templates folder for this user+grid.
 * Returns null when it does not (or when the folder doesn't exist yet, i.e. a
 * grid that has not run migration 0035) — callers must surface an error rather
 * than writing the template somewhere else.
 */
export function resolveTemplatesFolderId(uc, { gridId, userId, parentFolderId }) {
  const folder = findTemplatesFolder(uc, { gridId, userId });
  if (!folder) return null;
  if (!parentFolderId) return folder.id;

  let cur = uc?.foldersById?.[parentFolderId];
  for (let i = 0; cur && i < MAX_FOLDER_DEPTH; i++) {
    if (cur.userId !== userId || cur.gridId !== gridId) return null;
    if (cur.id === folder.id) return parentFolderId;
    cur = cur.parentId ? uc.foldersById?.[cur.parentId] : null;
  }
  return null;
}
