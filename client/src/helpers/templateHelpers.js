// helpers/templateHelpers.js — traversal helpers for the Templates manifest.
//
// Templates live as real occurrence subtrees inside a `manifestType: "templates"` manifest.
// Each template root occurrence carries `meta.templateName` and is parented to a folder
// in the templates manifest. The module behind it carries `meta.templateModule: true`.

export function templatesManifestFor(state, gridId) {
  return Object.values(state?.manifestsById || {})
    .find(m => m.gridId === gridId && m.manifestType === "templates");
}

export function rootFolderForTemplates(state, gridId) {
  const m = templatesManifestFor(state, gridId);
  return m ? state?.foldersById?.[m.rootFolderId] : null;
}

export function templateOccurrencesInFolder(state, folderId) {
  return Object.values(state?.occurrencesById || {})
    .filter(o => o.parentId === folderId && o.meta?.templateName);
}

export function templateKindOf(state, templateOccurrence) {
  if (!templateOccurrence) return null;
  const modId = templateOccurrence.moduleId || templateOccurrence.targetId;
  const m = state?.modulesById?.[modId];
  return m?.role || m?.kind || null;
}

export function templatesByKind(state, gridId, kindOrRole) {
  const root = rootFolderForTemplates(state, gridId);
  if (!root) return [];
  const acc = [];
  (function walk(folderId) {
    Object.values(state?.occurrencesById || {})
      .filter(o => o.parentId === folderId && o.meta?.templateName)
      .forEach(o => {
        if (templateKindOf(state, o) === kindOrRole) acc.push(o);
      });
    Object.values(state?.foldersById || {})
      .filter(f => f.parentId === folderId)
      .forEach(f => walk(f.id));
  })(root.id);
  return acc;
}
