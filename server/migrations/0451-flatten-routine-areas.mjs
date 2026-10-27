// 0451 — the Routines areas lose their inner containers, except Physical and
// Financial (user, 2026-10-27: "other than finances, and physical. could you delete
// the inner containers in the other dimensions of wellness and move all the habits
// to the top level of each").
//
// Per flattened area: each inner container's rows take its place in the area's list,
// in order (a row homed in the inner container is re-homed to the area; one homed
// elsewhere keeps its home), and the emptied inner container is deleted. The area's
// "New routine" button stops asking Where: its CREATE goes straight into the area.
export const id = "0451-flatten-routine-areas";
export const describe = "Routines: every area but Physical and Financial holds its habits directly; inner containers deleted; New routine creates in the area.";
export const touches = ["occurrences", "operations"];

export const KEEP = ["Physical", "Financial"];

/** Pure: the area's new list, the rows to re-home, and the inner containers to delete. */
export function planFlatten(area, byId, isContainer) {
  const list = [], rehome = [], drop = [];
  for (const id of area.occurrences || []) {
    const c = byId.get(id);
    if (c && isContainer(c)) {
      drop.push(id);
      for (const k of c.occurrences || []) {
        if (!list.includes(k)) list.push(k);
        if (byId.get(k)?.parentId === id) rehome.push(k);
      }
    } else if (!list.includes(id)) list.push(id);
  }
  return { list, rehome, drop };
}

/** Pure: a "New routine" form without Where, creating in `areaId`. */
export function directNewRoutine(pipeline, areaId) {
  const steps = (pipeline?.steps || []).map((s) => {
    const c = s.config || {};
    if (c.type === "ASK_FORM") return { ...s, config: { ...c, items: (c.items || []).filter((it) => it.key !== "where") } };
    if (c.type === "CREATE" && c.parent === "$form.values.where") return { ...s, config: { ...c, parent: `literal:${areaId}` } };
    return s;
  });
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation } = models;
  const pageMods = await Module.find({ gridId, role: "page", label: "Routines" }, { id: 1 }).lean();
  const pages = await Occurrence.find({ gridId, moduleId: { $in: pageMods.map((m) => m.id) } }).lean();
  if (pages.length !== 1) throw new Error(`expected one Routines page, found ${pages.length}`);
  const all = await Occurrence.find({ gridId }, { id: 1, moduleId: 1, parentId: 1, occurrences: 1, label: 1 }).lean();
  const byId = new Map(all.map((o) => [o.id, o]));
  const mods = new Map((await Module.find({ gridId }, { id: 1, role: 1, label: 1 }).lean()).map((m) => [m.id, m]));
  const isContainer = (o) => mods.get(o.moduleId)?.role === "container";
  const nameOf = (o) => o.label || mods.get(o.moduleId)?.label;
  const ops = await Operation.find({ gridId, name: "New routine" }).lean();

  const plans = [];
  for (const aid of pages[0].occurrences || []) {
    const area = byId.get(aid);
    if (!area || !isContainer(area) || KEEP.includes(nameOf(area))) continue;
    const plan = planFlatten(area, byId, isContainer);
    if (!plan.drop.length) continue;
    const op = ops.find((o) => (o.pipeline?.steps || []).some((s) => s.config?.type === "ASK_FORM"
      && (s.config.items || []).some((it) => it.key === "where" && (it.options || []).some((opt) => plan.drop.includes(opt.value)))));
    const grand = plan.drop.flatMap((d) => (byId.get(d)?.occurrences || []).filter((k) => byId.get(k) && isContainer(byId.get(k))));
    if (grand.length) throw new Error(`${nameOf(area)}: an inner container holds containers — not flattening it`);
    plans.push({ area, plan, op });
    log(`  ${nameOf(area)}: ${plan.drop.length} inner (${plan.drop.map((d) => nameOf(byId.get(d))).join(", ")}) -> ${plan.list.length} habits at the top; New routine ${op ? "made direct" : "NOT FOUND"}`);
  }
  if (plans.some((p) => !p.op)) throw new Error("an area has no matching New routine op");
  if (dryRun) return;

  const now = new Date();
  for (const { area, plan, op } of plans) {
    if (plan.rehome.length) await Occurrence.updateMany({ gridId, id: { $in: plan.rehome } }, { $set: { parentId: area.id, updatedAt: now } });
    await Occurrence.updateOne({ gridId, id: area.id }, { $set: { occurrences: plan.list, updatedAt: now } });
    await Occurrence.updateMany({ gridId, occurrences: { $in: plan.drop } }, { $pull: { occurrences: { $in: plan.drop } } });
    await Occurrence.deleteMany({ gridId, id: { $in: plan.drop } });
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: directNewRoutine(op.pipeline, area.id) } });
  }
  for (const { area, plan } of plans) {
    const a = await Occurrence.findOne({ gridId, id: area.id }).lean();
    const left = await Occurrence.countDocuments({ gridId, id: { $in: plan.drop } });
    const missing = plan.list.filter((k) => !(a.occurrences || []).includes(k));
    if (left || missing.length) throw new Error(`${nameOf(area)}: ${left} inner left, ${missing.length} habits not listed`);
  }
  log("  applied. RESTART pm2.");
}
