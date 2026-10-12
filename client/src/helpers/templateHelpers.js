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

/**
 * A template's display name. It is named by its module label like any other
 * page — migration 0035 unset `meta.templateName`, so reading that would render
 * every template as "(unnamed)". A per-occurrence label override still wins,
 * matching how the renderer names every other occurrence.
 */
export function templateLabelOf(lookups, templateOccurrence) {
  if (!templateOccurrence) return "(unnamed)";
  const m = lookups?.modulesById?.[templateOccurrence.moduleId];
  return templateOccurrence.label || m?.label || "(unnamed)";
}

/** True when `folderId` is the Templates folder or a folder anywhere under it. */
function isUnderTemplates(lookups, folderId, rootId) {
  const folders = lookups?.foldersById || {};
  const seen = new Set();
  for (let id = folderId; id && !seen.has(id); id = folders[id]?.parentId) {
    if (id === rootId) return true;
    seen.add(id);
  }
  return false;
}

/**
 * Every template: an occurrence placed in the Templates folder OR in a folder under it
 * (Templates/Schedule holds one page per schedule template, 2026-10-12).
 */
export function templateOccurrences(lookups, gridId) {
  const folder = templatesFolderFor(lookups, gridId);
  if (!folder) return [];
  return Object.values(lookups?.occurrencesById || {})
    .filter(o => o?.parentId && isUnderTemplates(lookups, o.parentId, folder.id));
}

export function templatesByKind(lookups, gridId, kind) {
  return templateOccurrences(lookups, gridId).filter(o => templateKindOf(lookups, o) === kind);
}
