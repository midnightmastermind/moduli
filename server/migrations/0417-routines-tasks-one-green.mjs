// 0417 — every container and item on the Routines and Tasks pages wears ONE green.
//
// User 2026-10-17: "give routines and tasks all the same background green". The green
// is #3f774e, one Routines already used (10 items). Written on each MODULE (styleMode
// "own", ownStyle.bg), so a copy placed elsewhere that shares the module turns green too,
// and so do template clones of those modules (`meta.clonedFromModuleId`) — the Schedule's
// placed copies keep matching their source (0415). A placement's own colour on these
// pages is removed, or it would win over the module's.
//
// A module ALSO placed on a page this was not asked for (measured on poms grid: 3
// Routines containers share their module with containers on Trackers) is coloured on
// its Routines/Tasks PLACEMENT instead (occurrence ownStyle.bg), so Trackers keeps its look.
export const id = "0417-routines-tasks-one-green";
export const describe = "Routines + Tasks pages: every container and item module (and its clones) gets background #3f774e.";
export const touches = ["modules", "occurrences"];
export const GREEN = "#3f774e";
const PAGES = ["Routines", "Tasks"];
const ROLES = new Set(["container", "instance"]);
const KEEP_PAGES = new Set(["Trackers"]);

/** Pure: `{ modIds, occIds, placeIds }` — modules to colour, placement colours to drop, placements to colour. */
export function planOneGreen({ occurrences, modules }) {
  const mods = new Map(modules.map((m) => [m.id, m]));
  const occs = new Map(occurrences.map((o) => [o.id, o]));
  const parentOf = new Map();
  for (const o of occurrences) for (const c of o.occurrences || []) parentOf.set(c, o.id);
  const pageOf = (id) => {
    let cur = id;
    for (let d = 0; cur && d < 20; d++) {
      const m = mods.get(occs.get(cur)?.moduleId);
      if (m?.role === "page") return m.label;
      cur = parentOf.get(cur) || occs.get(cur)?.parentId;
    }
    return null;
  };
  const reached = new Map();   // moduleId -> [occurrence ids on Routines/Tasks]
  const seen = new Set();
  const walk = (id, d) => {
    const o = occs.get(id);
    if (!o || seen.has(id) || d > 8) return;
    seen.add(id);
    const m = mods.get(o.moduleId);
    if (m && ROLES.has(m.role)) reached.set(m.id, [...(reached.get(m.id) || []), o.id]);
    for (const c of o.occurrences || []) walk(c, d + 1);
  };
  for (const o of occurrences) {
    const m = mods.get(o.moduleId);
    if (m?.role === "page" && PAGES.includes(m.label)) for (const c of o.occurrences || []) walk(c, 0);
  }
  const kept = new Set();
  for (const o of occurrences) if (reached.has(o.moduleId) && KEEP_PAGES.has(pageOf(o.id))) kept.add(o.moduleId);
  const modSet = new Set([...reached.keys()].filter((id) => !kept.has(id)));
  for (const m of modules) if (modSet.has(m.meta?.clonedFromModuleId) && ROLES.has(m.role)) modSet.add(m.id);
  const isGreen = (m) => m.styleMode === "own" && m.ownStyle?.bg === GREEN;
  const modIds = [...modSet].filter((id) => !isGreen(mods.get(id)));
  const occIds = []; const placeIds = [];
  for (const [mid, ids] of reached) for (const oid of ids) {
    const o = occs.get(oid);
    if (kept.has(mid)) { if (o.ownStyle?.bg !== GREEN) placeIds.push(oid); }
    else if (o.ownStyle?.bg) occIds.push(oid);
  }
  return { modIds, occIds, placeIds };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const modules = await Module.find({ gridId }).lean();
  const occurrences = await Occurrence.find({ gridId }).lean();
  const { modIds, occIds, placeIds } = planOneGreen({ occurrences, modules });
  log(`${modIds.length} module(s) -> ${GREEN}; ${occIds.length} placement colour(s) removed; ${placeIds.length} shared-module placement(s) coloured.`);
  if (dryRun) return;
  const byId = new Map(modules.map((m) => [m.id, m]));
  for (const id of modIds) {
    const m = byId.get(id);
    await Module.updateOne({ gridId, id }, { $set: { styleMode: "own", ownStyle: { ...(m.ownStyle || {}), bg: GREEN } } });
  }
  if (occIds.length) await Occurrence.updateMany({ gridId, id: { $in: occIds } }, { $unset: { "ownStyle.bg": "" } });
  // `ownStyle` may be null, which a dotted `$set` cannot write into — set the whole object.
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  for (const oid of placeIds) {
    await Occurrence.updateOne({ gridId, id: oid }, { $set: { ownStyle: { ...(occById.get(oid)?.ownStyle || {}), bg: GREEN } } });
  }
  const again = planOneGreen({ occurrences: await Occurrence.find({ gridId }).lean(), modules: await Module.find({ gridId }).lean() });
  if (again.modIds.length || again.occIds.length || again.placeIds.length) throw new Error("readback: something left uncoloured");
  log("applied and read back.");
}
