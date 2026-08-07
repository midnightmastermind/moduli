// helpers/protectedFolders.js
//
// CLIENT TWIN of `server/utils/protectedFolders.js` — keep the two in sync (the
// same relationship `alarmOps` has with `makeAlarmOp`). The server owns the
// enforcement (`assertNotProtectedFolder` throws inside `delete_folder`); this
// file exists so the UI can stop OFFERING a delete the server is going to
// refuse.
//
// WHY THAT MATTERS MORE THAN IT LOOKS. The folder delete in `ManifestTree`
// REPARENTS every child out to the folder's parent BEFORE emitting the delete.
// If the delete is then refused server-side, the reparenting has already
// happened and been persisted — the folder survives a reload with its contents
// scattered across the root. So a protected folder whose delete is still on the
// menu is worse than one with no protection at all: the guard converts a clean
// destructive action into a half-applied one.
//
// Protection is carried by `meta.protected`, NEVER by the name — the user may
// have their own folder called "Imports" and it is theirs to delete.

export const TEMPLATES_FOLDER_NAME = "Templates";
export const FILES_FOLDER_NAME = "Files";
export const IMPORTS_FOLDER_NAME = "Imports";

export function isProtectedFolder(folder) {
  return !!folder?.meta?.protected;
}
