// helpers/plannedDrop.js
//
// Dragging a piece OUT of a Magic view keeps it (user, 2026-10-15: "you can only copy outside of the
// magic"). A Magic view renders a PLANNED tree — occurrences `import_plan` laid out and nothing wrote,
// held in an isolated state (helpers/readerPlan). Its rows have ids no store and no server has ever
// seen, so the ordinary drop handlers find nothing and do nothing.
//
// A planned node dragged out is therefore always a COPY: the node and everything under it (its
// listed children AND the blocks its text embeds — list chips, link chips, quotes) is minted for
// real with fresh ids, and the drop then places that copy the way it would place any row. The Magic
// view is untouched; there is no move or copy-link out of it.
//
//   registerPlannedState(state)          a Magic view announces its isolated state while mounted
//   plannedStateFor(occId)               the registered state holding this id, or null
//   collectPlannedSubtree(rootId, state) the ids to mint, children before parents
//   planMaterialize({...})               the modules + occurrences to create (pure)
//   materializePlanned({...})            creates them; returns the new root's id
import { useEffect } from "react";
import * as CommitHelpers from "./CommitHelpers";

const registry = new Set();

export function registerPlannedState(state) {
  if (!state) return () => {};
  registry.add(state);
  return () => registry.delete(state);
}

/** Registers a Magic view's isolated state for as long as the component is mounted. */
export function usePlannedRegistration(state) {
  useEffect(() => registerPlannedState(state), [state]);
}

export function plannedStateFor(occId) {
  if (!occId) return null;
  for (const st of registry) {
    if ((st.occurrences || []).some((o) => o?.id === occId)) return st;
  }
  return null;
}

/** Test seam. */
export function __resetPlannedRegistry() { registry.clear(); }

const EMBED_TYPES = new Set(["moduleEmbed", "instanceTextblock", "instanceTextblockInline", "instancePill"]);

function embedIds(textmap, out = []) {
  if (!textmap || typeof textmap !== "object") return out;
  if (EMBED_TYPES.has(textmap.type) && textmap.attrs?.occurrenceId) out.push(textmap.attrs.occurrenceId);
  for (const c of textmap.content || []) embedIds(c, out);
  return out;
}

/** Every planned occurrence under `rootId` (listed or embedded), children before their parents. */
export function collectPlannedSubtree(rootId, state) {
  const byId = new Map((state?.occurrences || []).map((o) => [o.id, o]));
  const order = [];
  const seen = new Set();
  const walk = (id, depth) => {
    if (!id || seen.has(id) || depth > 40) return;
    const occ = byId.get(id);
    if (!occ) return;
    seen.add(id);
    for (const c of occ.occurrences || []) walk(c, depth + 1);
    for (const c of embedIds(occ.textmap)) walk(c, depth + 1);
    order.push(id);
  };
  walk(rootId, 0);
  return order;
}

function remapTextmap(node, occMap, modMap) {
  if (!node || typeof node !== "object") return node;
  const out = { ...node };
  if (node.attrs) {
    const attrs = { ...node.attrs };
    if (attrs.occurrenceId && occMap[attrs.occurrenceId]) attrs.occurrenceId = occMap[attrs.occurrenceId];
    if (attrs.instanceId && modMap[attrs.instanceId]) attrs.instanceId = modMap[attrs.instanceId];
    out.attrs = attrs;
  }
  if (Array.isArray(node.content)) out.content = node.content.map((c) => remapTextmap(c, occMap, modMap));
  return out;
}

/**
 * The records to create for a copy of the planned subtree at `rootId`. Pure.
 * Fresh ids everywhere; references inside the subtree (child lists, parentIds, embeds in text)
 * point at the copies. The root is parented to `parentId` (null = placed by the drop afterwards).
 */
export function planMaterialize({ rootId, state, gridId, userId, parentId = null, newId = () => crypto.randomUUID() }) {
  const ids = collectPlannedSubtree(rootId, state);
  if (!ids.length) return null;
  const occById = new Map((state.occurrences || []).map((o) => [o.id, o]));
  const modById = new Map((state.modules || []).map((m) => [m.id, m]));
  const occMap = {}, modMap = {};
  for (const id of ids) {
    occMap[id] = newId();
    const mid = occById.get(id)?.moduleId;
    if (mid && !modMap[mid]) modMap[mid] = newId();
  }
  // Who lists / embeds whom, inside the subtree — a copy's parent is the copy of its planned parent.
  const parentOf = {};
  for (const id of ids) {
    const occ = occById.get(id);
    for (const c of [...(occ.occurrences || []), ...embedIds(occ.textmap)]) if (occMap[c] && !parentOf[c]) parentOf[c] = id;
  }
  const modules = Object.entries(modMap).map(([oldId, nid]) => {
    const m = modById.get(oldId) || {};
    const { _id, id, userId: _u, gridId: _g, ...rest } = m; // eslint-disable-line no-unused-vars
    return { ...rest, id: nid, userId, gridId };
  });
  const occurrences = ids.map((id) => {
    const o = occById.get(id);
    const { _id, id: _oid, userId: _u, gridId: _g, ...rest } = o; // eslint-disable-line no-unused-vars
    return {
      ...rest,
      id: occMap[id],
      userId, gridId,
      moduleId: modMap[o.moduleId] || o.moduleId,
      parentId: id === rootId ? parentId : (occMap[parentOf[id]] || null),
      occurrences: (o.occurrences || []).map((c) => occMap[c]).filter(Boolean),
      textmap: o.textmap ? remapTextmap(o.textmap, occMap, modMap) : o.textmap ?? null,
      meta: { ...(o.meta || {}) },
      fields: { ...(o.fields || {}) },
    };
  });
  return { rootId: occMap[rootId], rootModuleId: modMap[occById.get(rootId)?.moduleId] || null, modules, occurrences };
}

/** Creates the copy (local store + server). Returns the plan (with `rootId`) or null. */
export function materializePlanned({ rootId, state, gridId, userId, parentId = null, dispatch, socket }) {
  if (!gridId || !userId) return null;
  const plan = planMaterialize({ rootId, state, gridId, userId, parentId });
  if (!plan) return null;
  for (const m of plan.modules) CommitHelpers.createModule({ dispatch, socket, module: m, emit: true });
  // Children first, so a parent's child list never names a row the server has not been told about.
  for (const o of plan.occurrences) CommitHelpers.createOccurrence({ dispatch, socket, occurrence: o, emit: true, fireTrigger: false });
  return plan;
}
