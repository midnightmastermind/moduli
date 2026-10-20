// helpers/fieldCategories.js
// ============================================================
// The Fields tab's grouping, shared with the row "+ field" menu.
//
// Command Center → Fields shows a grid's fields in category columns, and the
// "+" a row shows on hover (ui/FieldAddMenu) shows the SAME fields in the SAME
// groups — user 2026-10-20: *"a field creation menu there exactly like the
// command center one"*. Two copies of "which folders are field categories" and
// "which column does a field sit in" is how the two would drift, so both read
// these.
// ============================================================

import { orderColumn } from "./categoryColumnSort";

/**
 * The category folders for the FIELD axis, in sort order. `categoryKind` is
 * stamped at creation; a legacy folder (null) is a field category unless it
 * holds operations and no fields.
 */
export function fieldCategoryFolders({ foldersById, fieldsById, operationsById, gridId }) {
  const fieldFolderIds = new Set(Object.values(fieldsById || {}).map((f) => f?.folderId).filter(Boolean));
  const opFolderIds = new Set(Object.values(operationsById || {}).map((o) => o?.folderId).filter(Boolean));
  return Object.values(foldersById || {})
    .filter((f) => f && f.gridId === gridId && f.folderType === "category")
    .filter((f) => (f.categoryKind
      ? f.categoryKind === "field"
      : (fieldFolderIds.has(f.id) || !opFolderIds.has(f.id))))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

/** `{ uncategorized: [...], [folderId]: [...] }`, each column in display order. */
export function groupFieldsByCategory(fields, categoryFolders) {
  const groups = { uncategorized: [] };
  for (const f of categoryFolders || []) groups[f.id] = [];
  for (const field of fields || []) {
    const key = field.folderId && groups[field.folderId] !== undefined ? field.folderId : "uncategorized";
    groups[key].push(field);
  }
  for (const k of Object.keys(groups)) groups[k] = orderColumn(groups[k]);
  return groups;
}

/** "New Field", or "New Field 2", 3, … — field names are unique (2026-07-14). */
export function uniqueFieldName(fieldsById, base = "New Field") {
  const taken = new Set(Object.values(fieldsById || {})
    .map((f) => (f?.name || "").trim().toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}

/**
 * The bindings after asking for `fieldId` on this module, or null when it is
 * already showing. A binding that exists but is HIDDEN is shown — picking a
 * field is asking to see it. A new binding goes LAST and is born visible (a
 * grid-given field has no binding of its own, so this is also how one is shown).
 */
export function appendFieldBinding(bindings, fieldId) {
  if (!fieldId) return null;
  const list = Array.isArray(bindings) ? bindings : [];
  const existing = list.find((b) => b?.fieldId === fieldId);
  if (existing) {
    if (!existing.hidden) return null;
    return list.map((b) => (b === existing ? { ...b, hidden: false } : b));
  }
  const order = list.reduce((m, b) => Math.max(m, Number.isFinite(b?.order) ? b.order : -1), -1) + 1;
  return [...list, { fieldId, role: "input", order, hidden: false }];
}
