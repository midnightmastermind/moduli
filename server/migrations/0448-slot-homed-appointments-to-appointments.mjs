// 0448 — appointments filed INSIDE a Schedule slot move to Tasks › Appointments
// (user, 2026-10-27: "Move them to Appointments").
//
// 0447 copy-links an appointment into its start slot and leaves one that is
// homed in a slot alone, so the old weekly series (Physical Therapist,
// "Appointment"), Therapy with Keith and the Oct 26 Keith follow-up still worked
// the old way. Each is re-homed: parentId -> the Appointments container, listed
// there, unlisted from every slot. Fields are untouched, so `Schedule: Place
// Dated Work` gives each one its linked copy the next time its day is on screen.
export const id = "0448-slot-homed-appointments-to-appointments";
export const describe = "Appointments homed in a Schedule slot move to Tasks › Appointments (0447 then copy-links them in).";
export const touches = ["occurrences"];

/** Pure: which appointments to move, and which slots list each. */
export function planMoves(occurrences, { isAppointmentModule, slotFormatFieldId }) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const isSlot = (o) => o?.fields?.[slotFormatFieldId]?.value === "slot";
  const listers = new Map();
  for (const o of occurrences) for (const c of o.occurrences || []) {
    if (!listers.has(c)) listers.set(c, []);
    listers.get(c).push(o.id);
  }
  const plan = [];
  for (const o of occurrences) {
    if (!isAppointmentModule(o.moduleId) || o.meta?.feedSourceId || o.meta?.datedWork) continue;
    if (!isSlot(byId.get(o.parentId))) continue;
    plan.push({ id: o.id, from: o.parentId, unlistFrom: (listers.get(o.id) || []).filter((p) => isSlot(byId.get(p))) });
  }
  return plan;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const fid = async (name) => {
    const fs = await Field.find({ gridId, name }).lean();
    if (fs.length !== 1) throw new Error(`expected one field "${name}", found ${fs.length}`);
    return fs[0].id;
  };
  const typeFieldId = await fid("Schedule Type");
  const slotFormatFieldId = await fid("Schedule Format");

  const tasksMods = await Module.find({ gridId, role: "page", label: "Tasks" }, { id: 1 }).lean();
  const apptMods = await Module.find({ gridId, label: "Appointments", role: "container" }, { id: 1 }).lean();
  const candidates = await Occurrence.find({ gridId, moduleId: { $in: apptMods.map((m) => m.id) } }).lean();
  const tasksPages = await Occurrence.find({ gridId, moduleId: { $in: tasksMods.map((m) => m.id) } }, { id: 1 }).lean();
  const tasksIds = new Set(tasksPages.map((p) => p.id));
  const home = candidates.filter((c) => tasksIds.has(c.parentId));
  if (home.length !== 1) throw new Error(`expected one Appointments container on a Tasks page, found ${home.length}`);
  const dest = home[0];

  const apptModIds = new Set((await Module.find({ gridId, "fieldBindings.fieldId": typeFieldId }, { id: 1 }).lean()).map((m) => m.id));
  const occs = await Occurrence.find({ gridId }, { id: 1, moduleId: 1, parentId: 1, occurrences: 1, fields: 1, meta: 1, label: 1 }).lean();
  const plan = planMoves(occs, { isAppointmentModule: (m) => apptModIds.has(m), slotFormatFieldId });
  log(`  ${plan.length} appointment(s) homed in a slot -> Appointments (${dest.id})`);
  for (const p of plan) log(`    ${occs.find((o) => o.id === p.id)?.label || p.id}  unlisted from ${p.unlistFrom.length} slot(s)`);
  if (dryRun || !plan.length) return;

  const now = new Date();
  for (const p of plan) {
    await Occurrence.updateOne({ gridId, id: p.id }, { $set: { parentId: dest.id, updatedAt: now } });
    if (p.unlistFrom.length) await Occurrence.updateMany({ gridId, id: { $in: p.unlistFrom } }, { $pull: { occurrences: p.id }, $set: { updatedAt: now } });
  }
  await Occurrence.updateOne({ gridId, id: dest.id }, { $addToSet: { occurrences: { $each: plan.map((p) => p.id) } }, $set: { updatedAt: now } });

  const after = await Occurrence.find({ gridId }, { id: 1, moduleId: 1, parentId: 1, occurrences: 1, fields: 1, meta: 1 }).lean();
  const left = planMoves(after, { isAppointmentModule: (m) => apptModIds.has(m), slotFormatFieldId });
  const destAfter = after.find((o) => o.id === dest.id);
  const unlisted = plan.filter((p) => !(destAfter.occurrences || []).includes(p.id));
  if (left.length || unlisted.length) throw new Error(`${left.length} still in a slot, ${unlisted.length} not listed by Appointments`);
  log("  applied. RESTART pm2.");
}
