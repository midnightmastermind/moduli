// helpers/templateHelpers.js — templates are the children of the Templates folder.
//
// Location is the ONLY marker. There is no templates manifest, no
// meta.templateName, and no module.meta.templateModule — see
// docs/superpowers/specs/2026-08-02-template-editing-design.md

export function templatesFolderFor(lookups, gridId) {
  return Object.values(lookups?.foldersById || {})
    .find(f => f.gridId === gridId && f.meta?.protected && f.name === "Templates") || null;
}

/**
 * The GRANULAR kind — board / doc / canvas / table — so a board page is only
 * ever offered board templates. Returning `role` here would collapse every page
 * to "page" and defeat the compatibility filter.
 */
export function templateKindOf(lookups, templateOccurrence) {
  if (!templateOccurrence) return null;
  const m = lookups?.modulesById?.[templateOccurrence.moduleId];
  return m?.kind || m?.role || null;
}

export function templatesByKind(lookups, gridId, kind) {
  const folder = templatesFolderFor(lookups, gridId);
  if (!folder) return [];
  return Object.values(lookups?.occurrencesById || {})
    .filter(o => o.parentId === folder.id && templateKindOf(lookups, o) === kind);
}
