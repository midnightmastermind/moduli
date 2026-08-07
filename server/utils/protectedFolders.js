//
// THE rule for "this folder cannot be deleted". Mirrors utils/protectedGrids.js,
// including its hardest-won lesson: the check THROWS. A boolean someone forgets
// to check is not a guard.
//
// Protection is carried by `meta.protected`, NOT by the name — the user may have
// their own folder called "Templates" somewhere in the tree and it is theirs to
// delete. The migration stamps the flag on the one folder that matters.

export const TEMPLATES_FOLDER_NAME = "Templates";

// Where the FILES live — the same idea one level over. Artifacts had no home:
// bytes landed in `uploads/user/YYYY-MM/` (sharded, deduped, thumbnailed) while
// the artifact OCCURRENCE landed wherever the pointer was and was listed by
// nothing, which is why Command Center's Files tab scrapes `modulesById`.
// See docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md, Task 4.
export const FILES_FOLDER_NAME = "Files";

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
