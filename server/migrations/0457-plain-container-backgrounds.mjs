// 0457 — the containers on the Trackers, Routines and Tasks pages lose their own background colour, so each reads
// like Today's Stats: a black container, its tiles green (user, 2026-10-29: "make the background color of tasks and
// routines inner containers the same color as the trackers containers … we want black background like todays stats
// … and have all trackers match that as well"). Today's Physical & co. were green only because they carried a stored
// dimension colour (#b34f24 …) that the Terminal skin re-hues green; Today's Workout / Nutrition showed it raw (brown).
// Removes `ownStyle.bg` from every CONTAINER under the three pages — on its module and on its placement — and puts a
// module whose own style is then empty back to Inherit. Rows (instances) keep their colours. A container module also
// placed outside these pages is listed; it is changed too (its placements elsewhere were the same colour by sharing).
export const id = "0457-plain-container-backgrounds";
export const describe = "Clears the stored background colour on every container under the Trackers, Routines and Tasks pages.";
export const touches = ["occurrences", "modules"];

export const PAGES = { Trackers: "5zaCM_ScvI7n", Routines: "n1KSK9wrbjuX", Tasks: "9zU5UYHq5FMn" };

/** Container placements under the pages (pages and containers walked, rows not). Pure. */
export function planPlain(rootIds, occById, modById) {
  const occIds = []; const modIds = new Set(); const seen = new Set(); const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop(); if (seen.has(id)) continue; seen.add(id);
    const o = occById.get(id); if (!o) continue;
    const m = modById.get(o.moduleId);
    if (!rootIds.includes(id) && m?.role !== "container") continue;
    if (m?.role === "container") {
      if (o.ownStyle?.bg) occIds.push(id);
      if (m.ownStyle?.bg) modIds.add(m.id);
    }
    for (const c of o.occurrences || []) stack.push(c);
  }
  return { occIds, modIds: [...modIds] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  for (const [n, pid] of Object.entries(PAGES)) if (!(await Occurrence.exists({ gridId, id: pid }))) throw new Error(`no ${n} page`);
  const load = async () => {
    const occs = await Occurrence.find({ gridId }).select("id moduleId occurrences ownStyle label").lean();
    const mods = await Module.find({ gridId }).select("id role label ownStyle styleMode").lean();
    return { occs, occById: new Map(occs.map((o) => [o.id, o])), modById: new Map(mods.map((m) => [m.id, m])) };
  };
  const { occs, occById, modById } = await load();
  const plan = planPlain(Object.values(PAGES), occById, modById);
  const inPlan = new Set(); // placements reached by the walk
  { const st = [...Object.values(PAGES)]; while (st.length) { const id = st.pop(); if (inPlan.has(id)) continue; inPlan.add(id); for (const c of occById.get(id)?.occurrences || []) st.push(c); } }
  log(`  modules ${plan.modIds.length}: ${plan.modIds.map((id) => `${modById.get(id).label} ${modById.get(id).ownStyle.bg}`).join(", ")}`);
  log(`  placements ${plan.occIds.length}: ${plan.occIds.map((id) => occById.get(id).label || modById.get(occById.get(id).moduleId)?.label).join(", ")}`);
  const outside = plan.modIds.map((mid) => [mid, occs.filter((o) => o.moduleId === mid && !inPlan.has(o.id)).length]).filter(([, n]) => n);
  log(`  also placed outside these pages: ${outside.length ? outside.map(([m, n]) => `${modById.get(m).label} ×${n}`).join(", ") : "none"}`);
  if (dryRun) return;
  const now = new Date();
  if (plan.occIds.length) await Occurrence.updateMany({ gridId, id: { $in: plan.occIds } }, { $unset: { "ownStyle.bg": "" }, $set: { updatedAt: now } });
  for (const mid of plan.modIds) {
    const m = modById.get(mid); const rest = { ...m.ownStyle }; delete rest.bg;
    const empty = !Object.values(rest).some((v) => v != null && v !== "");
    await Module.updateOne({ gridId, id: mid }, { $unset: { "ownStyle.bg": "" }, $set: { updatedAt: now, ...(empty ? { styleMode: "inherit" } : {}) } });
  }
  const again = await load();
  const left = planPlain(Object.values(PAGES), again.occById, again.modById);
  if (left.occIds.length || left.modIds.length) throw new Error(`still coloured: ${left.occIds.length} placements, ${left.modIds.length} modules`);
  log("  applied. RESTART pm2.");
}
