//
// THE rule for "this folder cannot be deleted". Mirrors utils/protectedGrids.js,
// including its hardest-won lesson: the check THROWS. A boolean someone forgets
// to check is not a guard.
//
// Protection is carried by `meta.protected`, NOT by the name — the user may have
// their own folder called "Templates" somewhere in the tree and it is theirs to
// delete. The migration stamps the flag on the one folder that matters.

export const TEMPLATES_FOLDER_NAME = "Templates";

export function isProtectedFolder(folder) {
  return !!folder?.meta?.protected;
}

export function assertNotProtectedFolder(folder, action = "modify") {
  if (isProtectedFolder(folder)) {
    throw new Error(
      `Refusing to ${action} protected folder "${folder.name}" (${folder.id ?? "no id"})`,
    );
  }
}
