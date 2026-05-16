// helpers/templateHelpers.js — traversal helpers for the Templates manifest.
//
// Templates live as real occurrence subtrees inside a `manifestType: "templates"` manifest.
// Each template root occurrence carries `meta.templateName` and is parented to a folder
// in the templates manifest. The module behind it carries `meta.templateModule: true`.

export function templatesManifestFor(lookups, gridId) {
  return Object.values(lookups?.manifestsById || {})
    .find(m => m.gridId === gridId && m.manifestType === "templates");
}

export function rootFolderForTemplates(lookups, gridId) {
  const m = templatesManifestFor(lookups, gridId);
  return m ? lookups?.foldersById?.[m.rootFolderId] : null;
}

export function templateOccurrencesInFolder(lookups, folderId) {
  return Object.values(lookups?.occurrencesById || {})
    .filter(o => o.parentId === folderId && o.meta?.templateName);
}

export function templateKindOf(lookups, templateOccurrence) {
  if (!templateOccurrence) return null;
  const modId = templateOccurrence.moduleId || templateOccurrence.targetId;
  const m = lookups?.modulesById?.[modId];
  return m?.role || m?.kind || null;
}

export function templatesByKind(lookups, gridId, kindOrRole) {
  const root = rootFolderForTemplates(lookups, gridId);
  if (!root) return [];
  const acc = [];
  (function walk(folderId) {
    Object.values(lookups?.occurrencesById || {})
      .filter(o => o.parentId === folderId && o.meta?.templateName)
      .forEach(o => {
        if (templateKindOf(lookups, o) === kindOrRole) acc.push(o);
      });
    Object.values(lookups?.foldersById || {})
      .filter(f => f.parentId === folderId)
      .forEach(f => walk(f.id));
  })(root.id);
  return acc;
}
