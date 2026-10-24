// services/readSubtree.js — one page (or file) and everything it draws, for a reader that does not load the grid.
//
// The Quest app's reader windows loaded the WHOLE app to show one page (~15MB of grid for a note), and every one of
// them was a full app tab sharing storage with the others. A reader needs the root, what it lists (`occurrences[]`),
// what is parented to it, and what its bodies EMBED (a doc draws its textmap; ~474 embeds on poms grid are reachable
// only that way — client helpers/textmapEmbeds says why), plus their modules, fields and views.
//
// Reads the warm cache when there is one (it holds the newest edits), else Mongo, a level at a time.
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import Field from "../models/Field.js";
import View from "../models/View.js";
import { decompressTextmap, isCompressed } from "../utils/textmapCompression.js";

/** The most nodes one read returns: a page, not a grid. */
export const SUBTREE_CAP = 3000;

const EMBED_TYPES = /embed|textblock/i;

/** Every occurrence id a textmap's nodes name. Pure; a compressed or odd textmap names nothing. */
export function embeddedIds(textmap) {
  const out = [];
  if (!textmap || typeof textmap !== "object") return out;
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 60) return;
    if (EMBED_TYPES.test(String(node.type || ""))) {
      const id = node.attrs?.occurrenceId || node.attrs?.id;
      if (typeof id === "string" && id) out.push(id);
    }
    if (Array.isArray(node.content)) for (const k of node.content) walk(k, depth + 1);
  };
  walk(textmap, 0);
  return out;
}

const plainTextmap = (t) => (t && isCompressed(t) ? decompressTextmap(t) : t);

/** The ids one node leads to: what it lists, and what its body embeds. */
function childIdsOf(occ) {
  return [...(Array.isArray(occ.occurrences) ? occ.occurrences : []), ...embeddedIds(occ.textmap)];
}

/**
 * Walk from `root` (already loaded). `load(ids)` returns those occurrences; `kidsOf(ids)` returns the occurrences
 * parented to them. Both async. Pure apart from those.
 */
export async function walkSubtree(root, { load, kidsOf, cap = SUBTREE_CAP }) {
  const byId = new Map([[root.id, root]]);
  let frontier = [root];
  let truncated = false;
  while (frontier.length) {
    const ids = frontier.map((o) => o.id);
    const want = [...new Set(frontier.flatMap(childIdsOf))].filter((id) => !byId.has(id));
    const found = [...(want.length ? await load(want) : []), ...(await kidsOf(ids))];
    frontier = [];
    for (const o of found) {
      if (!o?.id || byId.has(o.id)) continue;
      if (byId.size >= cap) { truncated = true; break; }
      byId.set(o.id, o);
      frontier.push(o);
    }
    if (truncated) break;
  }
  return { occurrences: [...byId.values()], truncated };
}

/** Modules, fields and views the occurrences need. */
function neededIds(occurrences, modulesById) {
  const fieldIds = new Set();
  const viewIds = new Set();
  for (const o of occurrences) {
    for (const k of Object.keys(o.fields || {})) fieldIds.add(k);
    if (o.viewId) viewIds.add(o.viewId);
    for (const b of modulesById.get(o.moduleId)?.fieldBindings || []) if (b?.fieldId) fieldIds.add(b.fieldId);
  }
  return { fieldIds: [...fieldIds], viewIds: [...viewIds] };
}

/**
 * `{ occurrences, modules, fields, views, gridId, truncated }` for `rootId`, or null when the caller does not own it.
 * `uc` is the grid's warm cache (or null).
 */
export async function readSubtree({ rootId, userId, peekUserCache }) {
  const rootDoc = await Occurrence.findOne({ id: rootId, userId }).lean();
  if (!rootDoc) return null;
  const gridId = rootDoc.gridId;
  const uc = peekUserCache?.(userId, gridId) || null;

  let walk;
  if (uc?.occurrencesById) {
    const occs = uc.occurrencesById;
    const byParent = new Map();
    for (const o of Object.values(occs)) {
      if (!o?.parentId) continue;
      if (!byParent.has(o.parentId)) byParent.set(o.parentId, []);
      byParent.get(o.parentId).push(o);
    }
    const root = occs[rootId] || rootDoc;
    walk = await walkSubtree(root, {
      load: async (ids) => ids.map((id) => occs[id]).filter(Boolean),
      kidsOf: async (ids) => ids.flatMap((id) => byParent.get(id) || []),
    });
  } else {
    walk = await walkSubtree({ ...rootDoc, textmap: plainTextmap(rootDoc.textmap) }, {
      load: async (ids) => (await Occurrence.find({ id: { $in: ids }, userId }).lean()).map((o) => ({ ...o, textmap: plainTextmap(o.textmap) })),
      kidsOf: async (ids) => (await Occurrence.find({ parentId: { $in: ids }, userId }).lean()).map((o) => ({ ...o, textmap: plainTextmap(o.textmap) })),
    });
  }
  const occurrences = walk.occurrences.map((o) => (isCompressed(o.textmap) ? { ...o, textmap: plainTextmap(o.textmap) } : o));

  const moduleIds = [...new Set(occurrences.map((o) => o.moduleId).filter(Boolean))];
  const modules = uc?.modulesById
    ? moduleIds.map((id) => uc.modulesById[id]).filter(Boolean)
    : await Module.find({ id: { $in: moduleIds }, userId }).lean();
  const modulesById = new Map(modules.map((m) => [m.id, m]));
  const { fieldIds, viewIds } = neededIds(occurrences, modulesById);
  const fields = uc?.fieldsById
    ? fieldIds.map((id) => uc.fieldsById[id]).filter(Boolean)
    : await Field.find({ id: { $in: fieldIds }, userId }).lean();
  const views = uc?.viewsById
    ? viewIds.map((id) => uc.viewsById[id]).filter(Boolean)
    : await View.find({ id: { $in: viewIds }, userId }).lean();

  return { gridId, occurrences, modules, fields, views, truncated: walk.truncated };
}
