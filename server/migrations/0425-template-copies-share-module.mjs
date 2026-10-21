// 0425 — a template's copies go back to the template's own module.
//
// User, 2026-10-21: *"copy link the ones into template and then copy the template
// one (doesnt link with the new copies) but they all keep the same module"* and
// *"we can change the label on occurances without affecting the original model"*.
// Applying a template now places the template node's own module again (client
// APPLY_TEMPLATE + server cloneSubtree). Until today each node got ONE copy module,
// stamped `meta.clonedFromModuleId`; this folds those back.
//
// A copy module is folded when it matches its source on role, kind and every
// other key, apart from what can be carried without loss:
//   · its NAME, drag mode and module style move onto each placement (occurrence
//     label / dragMode / ownStyle — the per-placement versions of the same things);
//   · bindings it has that the source lacks are ADDED to the source (no row loses a field).
// Then:
//   · every occurrence placing it points at the source module instead;
//   · if the copy's name differs (a renamed root), that name moves onto each
//     such occurrence's own label (unless it already has one);
//   · doc text that embeds it by module id (`instanceId`) is re-pointed;
//   · the copy module is deleted.
// A copy whose other settings differ (meta: layout, graph…), or whose source is
// gone, is left as it is and listed.
//
// Idempotent: a folded copy no longer exists, and nothing else is touched.

import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0425-template-copies-share-module";
export const describe = "Template copies use the template's own module again: each copy module is DELETED after its placements are re-pointed at the source (its name, drag mode and style move onto each placement; bindings it had that the source lacks are added to the source; doc embeds are re-pointed). Copies whose other settings (meta) differ, or whose source is gone, are left alone and listed.";
export const touches = ["modules", "occurrences"];

const CLONE_OF = "clonedFromModuleId";
const IGNORED = new Set(["_id", "id", "__v", "label", "name", "createdAt", "updatedAt", "userId", "gridId",
  // Carried, not compared (see planFolds): drag mode and module style move onto
  // each placement, bindings are unioned into the source module.
  "defaultDragMode", "ownStyle", "styleMode", "fieldBindings"]);
const IGNORED_META = new Set([CLONE_OF, "templateModule", "templateName", "identitySignature", "appliedFromTemplateId"]);

/** A module's comparable shape: everything but its identity, name and the copy stamps. PURE. */
export function comparable(mod) {
  const out = {};
  for (const [k, v] of Object.entries(mod || {})) {
    if (IGNORED.has(k) || v == null) continue;
    if (k === "meta") {
      const meta = {};
      for (const [mk, mv] of Object.entries(v || {})) if (!IGNORED_META.has(mk) && mv != null) meta[mk] = mv;
      if (Object.keys(meta).length) out.meta = meta;
      continue;
    }
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return JSON.stringify(sortKeys(out));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/**
 * Which copy modules fold into which source, and which are kept (and why). PURE.
 * @returns {{ folds: {copyId, sourceId, rename: string|null}[], kept: {copyId, sourceId, label, why}[] }}
 */
export function planFolds(modules) {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const folds = [], kept = [];
  for (const m of modules) {
    const srcId = m.meta?.[CLONE_OF];
    if (!srcId) continue;
    const src = byId.get(srcId);
    const label = m.label ?? m.name ?? null;
    if (!src || src.trashed) { kept.push({ copyId: m.id, sourceId: srcId, label, why: "source module gone" }); continue; }
    if (comparable(m) !== comparable(src)) {
      const a = JSON.parse(comparable(m)), b = JSON.parse(comparable(src));
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      kept.push({ copyId: m.id, sourceId: srcId, label, why: "differs: " + keys.join(", ") });
      continue;
    }
    const srcLabel = src.label ?? src.name ?? null;
    const srcFids = new Set((src.fieldBindings || []).map((b) => b.fieldId));
    folds.push({
      copyId: m.id, sourceId: srcId,
      rename: label !== srcLabel ? label : null,
      dragMode: m.defaultDragMode && m.defaultDragMode !== src.defaultDragMode ? m.defaultDragMode : null,
      ownStyle: m.styleMode === "own" && m.ownStyle && JSON.stringify(m.ownStyle) !== JSON.stringify(src.ownStyle) ? m.ownStyle : null,
      addBindings: (m.fieldBindings || []).filter((b) => !srcFids.has(b.fieldId)),
    });
  }
  return { folds, kept };
}

/** Re-point `instanceId` embeds in a (decompressed) textmap. Returns null when nothing changed. PURE. */
export function repointTextmap(tm, map) {
  if (!tm || typeof tm !== "object") return null;
  let changed = false;
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.attrs?.instanceId && map.has(n.attrs.instanceId)) { n.attrs.instanceId = map.get(n.attrs.instanceId); changed = true; }
    (n.content || []).forEach(walk);
  };
  const copy = JSON.parse(JSON.stringify(tm));
  walk(copy);
  return changed ? copy : null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const modules = await Module.find({ gridId }).lean();
  const { folds, kept } = planFolds(modules);
  const map = new Map(folds.map((f) => [f.copyId, f.sourceId]));
  const renameOf = new Map(folds.filter((f) => f.rename != null).map((f) => [f.copyId, f.rename]));
  const foldOf = new Map(folds.map((f) => [f.copyId, f]));
  // Bindings a copy carried that its source lacks: unioned into the source, so no row loses a field.
  const addTo = new Map();
  for (const f of folds) {
    if (!f.addBindings.length) continue;
    const list = addTo.get(f.sourceId) || [];
    for (const b of f.addBindings) if (!list.some((x) => x.fieldId === b.fieldId)) list.push(b);
    addTo.set(f.sourceId, list);
  }

  const placing = await Occurrence.find({ gridId, moduleId: { $in: [...map.keys()] } }, { id: 1, moduleId: 1, label: 1, dragMode: 1, ownStyle: 1 }).lean();
  const withText = await Occurrence.find({ gridId, textmap: { $ne: null } }, { id: 1, textmap: 1 }).lean();
  const textPatches = [];
  for (const o of withText) {
    const tm = decompressTextmap(o.textmap);
    const next = repointTextmap(tm, map);
    if (next) textPatches.push({ id: o.id, textmap: next });
  }

  log(`copy modules: ${folds.length + kept.length} · fold ${folds.length} (${renameOf.size} carry their name onto the placement) · keep ${kept.length}`);
  log(`placements re-pointed: ${placing.length} · doc texts re-pointed: ${textPatches.length}`);
  log(`carried onto placements: drag mode ${folds.filter((f) => f.dragMode).length} copies · style ${folds.filter((f) => f.ownStyle).length} copies · bindings added to ${addTo.size} source module(s)`);
  for (const k of kept) log(`  kept  ${k.label ?? "(unnamed)"}  ${k.copyId} → ${k.sourceId}  (${k.why})`);
  if (dryRun) return;

  for (const [srcId, extra] of addTo) {
    const src = modules.find((m) => m.id === srcId);
    const have = new Set((src.fieldBindings || []).map((b) => b.fieldId));
    const add = extra.filter((b) => !have.has(b.fieldId)).map(({ _id, ...b }) => b);
    if (add.length) await Module.updateOne({ id: srcId, gridId }, { $push: { fieldBindings: { $each: add } } });
  }
  for (const o of placing) {
    const f = foldOf.get(o.moduleId);
    const set = { moduleId: f.sourceId };
    const name = renameOf.get(o.moduleId);
    if (name != null && (o.label == null || o.label === "")) set.label = name;
    if (f.dragMode && !o.dragMode) set.dragMode = f.dragMode;
    if (f.ownStyle && !o.ownStyle) set.ownStyle = f.ownStyle;
    await Occurrence.updateOne({ id: o.id, gridId }, { $set: set });
  }
  for (const p of textPatches) {
    await Occurrence.updateOne({ id: p.id, gridId }, { $set: { textmap: compressTextmap(p.textmap) } });
  }
  const left = await Occurrence.countDocuments({ gridId, moduleId: { $in: [...map.keys()] } });
  if (left) throw new Error(`${left} placement(s) still name a copy module — not deleting`);
  const del = await Module.deleteMany({ gridId, id: { $in: [...map.keys()] } });
  log(`deleted ${del.deletedCount} copy module(s)`);
}
