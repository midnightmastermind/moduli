// 0450 — every row on the Tasks page drags as a COPY-LINK (user, 2026-10-27:
// "can you set all my tasks to copylink mode?").
//
// Drag mode lives on the placement (`occurrence.dragMode`, which wins over the
// module's `defaultDragMode`), so it is set there: the modules are shared with
// rows elsewhere (Routines, the Schedule) that keep their own mode. Rows are
// the instances reached from the Tasks page through its containers.
export const id = "0450-tasks-rows-copylink";
export const describe = "Every instance under the Tasks page gets dragMode: copylink (on the occurrence, not the shared module).";
export const touches = ["occurrences"];

/** Pure: ids of instances under `pageIds`, walking containers only. */
export function rowsUnder(pageIds, occurrences, roleOf) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const rows = new Set(), seen = new Set();
  const stack = pageIds.flatMap((p) => byId.get(p)?.occurrences || []);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const o = byId.get(id);
    if (!o) continue;
    const role = roleOf(o.moduleId);
    if (role === "instance") rows.add(id);
    else if (role === "container") stack.push(...(o.occurrences || []));
  }
  return [...rows];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const pageMods = await Module.find({ gridId, role: "page", label: "Tasks" }, { id: 1 }).lean();
  const pages = await Occurrence.find({ gridId, moduleId: { $in: pageMods.map((m) => m.id) } }, { id: 1 }).lean();
  const occs = await Occurrence.find({ gridId }, { id: 1, moduleId: 1, occurrences: 1, dragMode: 1 }).lean();
  const roles = new Map((await Module.find({ gridId }, { id: 1, role: 1 }).lean()).map((m) => [m.id, m.role]));
  const ids = rowsUnder(pages.map((p) => p.id), occs, (m) => roles.get(m));
  const todo = ids.filter((id) => occs.find((o) => o.id === id)?.dragMode !== "copylink");
  log(`  ${ids.length} row(s) under Tasks, ${todo.length} to set to copylink`);
  if (dryRun || !todo.length) return;
  await Occurrence.updateMany({ gridId, id: { $in: todo } }, { $set: { dragMode: "copylink", updatedAt: new Date() } });
  const left = await Occurrence.countDocuments({ gridId, id: { $in: ids }, dragMode: { $ne: "copylink" } });
  if (left) throw new Error(`${left} row(s) not set`);
  log("  applied. RESTART pm2.");
}
