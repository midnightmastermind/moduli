// server/migrations/0362-routine-containers-item-color.mjs
//
// "look into why visited is a diff color than the rest of the occurances in the
// physical container, it should be inherited" (user, 2026-09-25).
//
// Routines › Physical › Nutrition holds Cook / Drink / Eat — each carrying its
// OWN colour (#98431f, stamped per item by the seed so it follows the item into
// the Schedule) — and Visited, added in the app, which INHERITS. It inherits
// from the container's "item defaults" (`childInstanceStyle`), which the
// container never had: that key was not in the Module schema, so the Style
// tab's "Instance Defaults" was dropped on every save (0 modules held one).
//
// With the schema fixed, this gives each container on the Routines and Tasks
// pages the colour its own-coloured items already agree on, as its item
// default. An inheriting item (Visited, and anything added later) takes it; an
// item with its own colour is untouched. A container whose items disagree, or
// that already has an item default, is left alone. Restart pm2 after --apply.

export const id = "0362-routine-containers-item-color";
export const describe = "Gives each Routines / Tasks container the item colour its items already share as its item default, so items that inherit (e.g. Visited in Nutrition) match their siblings.";
export const touches = ["modules"];

const PAGES = ["Routines", "Tasks"];

/**
 * PURE: `{ containerModuleId: bg }` for containers under the given pages whose
 * own-coloured instance children all share one background.
 */
export function planItemDefaults({ occurrences, modulesById, pageOccIds }) {
  const byId = new Map(occurrences.map(o => [o.id, o]));
  const parentOf = new Map();
  for (const o of occurrences) for (const c of o.occurrences || []) if (!parentOf.has(c)) parentOf.set(c, o.id);
  const underPage = (id) => {
    const seen = new Set();
    for (let cur = parentOf.get(id); cur && !seen.has(cur); cur = parentOf.get(cur)) {
      if (pageOccIds.has(cur)) return true;
      seen.add(cur);
    }
    return false;
  };
  const plan = {};
  for (const o of occurrences) {
    const cm = modulesById.get(o.moduleId);
    if (cm?.role !== "container" || cm.childInstanceStyle || !underPage(o.id)) continue;
    const items = (o.occurrences || []).map(id => modulesById.get(byId.get(id)?.moduleId)).filter(m => m?.role === "instance");
    const colours = new Set(items.filter(m => m.styleMode === "own" && m.ownStyle?.bg).map(m => m.ownStyle.bg));
    if (colours.size === 1) {
      const bg = [...colours][0];
      if (plan[cm.id] && plan[cm.id] !== bg) plan[cm.id] = null;   // the same module placed twice, disagreeing
      else if (plan[cm.id] !== null) plan[cm.id] = bg;
    }
  }
  return Object.fromEntries(Object.entries(plan).filter(([, bg]) => bg));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const mods = await Module.find({ gridId }).lean();
  const modulesById = new Map(mods.map(m => [m.id, m]));
  const occurrences = await Occurrence.find({ gridId }).select({ id: 1, moduleId: 1, occurrences: 1 }).lean();
  const pageModIds = new Set(mods.filter(m => m.role === "page" && PAGES.includes(m.label)).map(m => m.id));
  const pageOccIds = new Set(occurrences.filter(o => pageModIds.has(o.moduleId)).map(o => o.id));
  if (!pageOccIds.size) { log("no Routines / Tasks page on this grid — nothing to do"); return; }

  const plan = planItemDefaults({ occurrences, modulesById, pageOccIds });
  log(`${Object.keys(plan).length} container(s) get an item default:`);
  for (const [mid, bg] of Object.entries(plan)) log(`   ${modulesById.get(mid)?.label} → ${bg}`);
  if (dryRun) { log("DRY RUN — nothing written"); return; }
  for (const [mid, bg] of Object.entries(plan)) {
    await Module.updateOne({ gridId, id: mid, childInstanceStyle: null }, { $set: { childInstanceStyle: { bg } } });
  }
  log("done. Restart the server (pm2) so the warm cache serves it.");
}
