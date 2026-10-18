// 0419 — a Schedule slot container does not bind Last Seen.
//
// Found comparing poms with the rebuild: 21 container modules (the Schedule Layout's Todo and
// 12:00am..12:00pm slots) bound Last Seen VISIBLY again, all changed at 2026-10-13 13:32 (the
// Combine Schedule migrations' day). 2026-10-12 had unbound them: Last Seen is stamped on the
// items placed into a slot (Schedule: Stamp Date & Time Slot, scoped to instances), never on
// the slot. The rebuild's slots bind Time Slot + Schedule Format only, hidden — this matches it.
// Only the BINDING is removed; a stored value on an occurrence is left.
export const id = "0419-slot-containers-drop-last-seen";
export const describe = "Container modules stop binding Last Seen (21 Schedule Layout slots on poms). Modules only.";
export const touches = ["modules"];

/** Pure: the container modules binding `fieldId`, with that binding removed. */
export function planDropBinding(modules, fieldId) {
  return modules
    .filter((m) => m.role === "container" && (m.fieldBindings || []).some((b) => b.fieldId === fieldId))
    .map((m) => ({ id: m.id, label: m.label, fieldBindings: m.fieldBindings.filter((b) => b.fieldId !== fieldId) }));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module } = models;
  const f = await Field.findOne({ gridId, name: "Last Seen" }).lean();
  if (!f) { log("no Last Seen field — nothing to do."); return; }
  const plan = planDropBinding(await Module.find({ gridId, role: "container" }).lean(), f.id);
  log(`${plan.length} container module(s) unbind Last Seen: ${plan.map((p) => p.label).join(", ")}`);
  if (dryRun || !plan.length) return;
  for (const p of plan) await Module.updateOne({ gridId, id: p.id }, { $set: { fieldBindings: p.fieldBindings } });
  const left = planDropBinding(await Module.find({ gridId, role: "container" }).lean(), f.id);
  if (left.length) throw new Error(`readback: ${left.length} still bind Last Seen`);
  log("applied and read back.");
}
