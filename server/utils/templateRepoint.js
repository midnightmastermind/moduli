// utils/templateRepoint.js — after "Save over" replaces a template, point what named the old one at the new one.
//
// save_over_template clones the copy into a NEW template root and deletes the old one. Copies record their
// template in `meta.appliedFromTemplateId`, and operations name templates by occurrence id (APPLY_TEMPLATE's
// templateRef, a FIND by id). Left alone, both point at a row that no longer exists. Pure: returns the writes.
//
// The new template root itself is cloned from a copy, so it carries the copy's `appliedFromTemplateId`; a
// template is not a copy of itself, so that key is removed from it.
export function planTemplateRepoint({ oldId, newId, occurrences = [], operations = [] }) {
  const out = { occurrences: [], operations: [] };
  if (!oldId || !newId || oldId === newId) return out;
  for (const o of occurrences) {
    if (!o?.id) continue;
    if (o.id === newId) {
      if (o.meta && "appliedFromTemplateId" in o.meta) {
        const { appliedFromTemplateId, ...meta } = o.meta;
        out.occurrences.push({ id: o.id, meta });
      }
      continue;
    }
    if (o.meta?.appliedFromTemplateId === oldId) {
      out.occurrences.push({ id: o.id, meta: { ...o.meta, appliedFromTemplateId: newId } });
    }
  }
  // Whole tokens only — an id inside a longer word ("old" in "older") is not a reference. Ids are made of
  // letters, digits, '_' and '-', so those are the characters that may not touch it.
  const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`(?<![A-Za-z0-9_-])${esc}(?![A-Za-z0-9_-])`, "g");
  const swap = (v) => {
    if (typeof v === "string") return v.replace(rx, newId);
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  for (const op of operations) {
    if (!op?.id || !op.pipeline) continue;
    const next = swap(op.pipeline);
    if (JSON.stringify(next) !== JSON.stringify(op.pipeline)) out.operations.push({ id: op.id, pipeline: next });
  }
  return out;
}
