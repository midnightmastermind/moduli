// services/gridCopy.js — copy a page / container / row (and everything it draws) into ANOTHER grid.
//
// Dragging between two windows on two grids (user, 2026-10-24: "have both in there"). Within one grid a copy may
// share its source's module; across grids it cannot — modules, fields and views belong to a grid — so every module
// is cloned, every view cloned, and every field MATCHED in the target grid by name and type (made there when it has
// none). Rows the subtree draws are found the way a reader finds them (services/readSubtree: listed, parented,
// embedded). Pure: no database here; the socket handler persists what this returns.
import { randomUUID } from "node:crypto";

const STRIP_OCC_KEYS = ["_id", "__v", "linkedGroupId"];

/** Map each source field id to a target field id; the fields to create in the target. Pure. */
export function mapFields({ fieldIds, sourceFieldsById, targetFields, targetGridId, userId, newId = randomUUID }) {
  const map = new Map();
  const created = [];
  const byKey = new Map();
  for (const f of targetFields || []) byKey.set(`${f.name}\u0000${f.type}`, f.id);
  for (const id of fieldIds) {
    const src = sourceFieldsById[id];
    if (!src) continue;
    const key = `${src.name}\u0000${src.type}`;
    let to = byKey.get(key);
    if (!to) {
      to = newId();
      const { _id, __v, ...rest } = src;
      void _id; void __v;
      created.push({ ...rest, id: to, gridId: targetGridId, userId, folderId: null });
      byKey.set(key, to);
    }
    map.set(id, to);
  }
  return { map, created };
}

function remapTextmap(textmap, occMap, modMap) {
  if (!textmap || typeof textmap !== "object") return textmap;
  const out = JSON.parse(JSON.stringify(textmap));
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    const a = n.attrs;
    if (a && typeof a === "object") {
      if (a.occurrenceId && occMap.has(a.occurrenceId)) a.occurrenceId = occMap.get(a.occurrenceId);
      if (a.instanceId && modMap.has(a.instanceId)) a.instanceId = modMap.get(a.instanceId);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(out);
  return out;
}

function remapFieldsObject(fields, fieldMap) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) if (fieldMap.has(k)) out[fieldMap.get(k)] = v;
  return out;
}

/**
 * Plan the copy. `sub` = { occurrences, modules, views } of the source (rootId among them). Returns
 * { rootId, occurrences, modules, views } for the TARGET, with new ids, the root parented to `parentId` (or folder
 * `parentFolderId`). Rows outside the subtree that its rows list are dropped from those lists.
 */
export function planGridCopy({ rootId, sub, fieldMap, targetGridId, userId, parentId = null, newId = randomUUID }) {
  const occMap = new Map(sub.occurrences.map((o) => [o.id, newId()]));
  const modMap = new Map(sub.modules.map((m) => [m.id, newId()]));
  const viewMap = new Map((sub.views || []).map((v) => [v.id, newId()]));
  const modules = sub.modules.map((m) => {
    const { _id, __v, ...rest } = m;
    void _id; void __v;
    return {
      ...rest, id: modMap.get(m.id), gridId: targetGridId, userId,
      fieldBindings: (m.fieldBindings || [])
        .filter((b) => fieldMap.has(b.fieldId))
        .map((b) => { const { _id: bid, ...bRest } = b; void bid; return { ...bRest, fieldId: fieldMap.get(b.fieldId) }; }),
    };
  });
  const views = (sub.views || []).map((v) => {
    const { _id, __v, ...rest } = v;
    void _id; void __v;
    return {
      ...rest, id: viewMap.get(v.id), gridId: targetGridId, userId,
      activeOccurrenceId: v.activeOccurrenceId && occMap.has(v.activeOccurrenceId) ? occMap.get(v.activeOccurrenceId) : null,
    };
  });
  const occurrences = sub.occurrences.map((o) => {
    const copy = { ...o };
    for (const k of STRIP_OCC_KEYS) delete copy[k];
    const meta = { ...(o.meta || {}) };
    delete meta.feedSourceId;
    return {
      ...copy,
      id: occMap.get(o.id),
      gridId: targetGridId,
      userId,
      moduleId: modMap.get(o.moduleId) || o.moduleId,
      targetId: modMap.get(o.moduleId) || o.moduleId,
      parentId: o.id === rootId ? parentId : (occMap.get(o.parentId) || null),
      occurrences: (o.occurrences || []).filter((c) => occMap.has(c)).map((c) => occMap.get(c)),
      viewId: o.viewId && viewMap.has(o.viewId) ? viewMap.get(o.viewId) : null,
      fields: remapFieldsObject(o.fields, fieldMap),
      textmap: remapTextmap(o.textmap, occMap, modMap),
      meta,
      identitySignature: null,
    };
  });
  return { rootId: occMap.get(rootId), occurrences, modules, views };
}

/** Every field id the subtree uses (its rows' values, its modules' bindings). Pure. */
export function fieldIdsOf(sub) {
  const ids = new Set();
  for (const o of sub.occurrences) for (const k of Object.keys(o.fields || {})) ids.add(k);
  for (const m of sub.modules) for (const b of m.fieldBindings || []) if (b?.fieldId) ids.add(b.fieldId);
  return [...ids];
}
