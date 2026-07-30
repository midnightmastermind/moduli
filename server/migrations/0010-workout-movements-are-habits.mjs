// User, 2026-07-30: "workouts is a habit".
//
// The 0008 rule made every Routines action a habit and left everything else a
// task — which put the 30 workout MOVEMENTS (Bench Press, Squat, …) on the
// tasks side, because they live on the Movements board rather than in the
// Routines catalog. Logging a lift is a routine, so they get the same hidden
// Habit marker: completing one now moves Completed Habits, not Completed Tasks.
//
// Identified structurally — the movement modules are whatever the Movements
// board container holds — so no label list to drift.
export const id = "0010-workout-movements-are-habits";
export const describe =
  "Binds the hidden Habit marker on the workout movement modules (the Movements board's contents) " +
  "so completing one counts as a habit rather than a task. Adds a binding; changes no values.";

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence } = models;
  const habit = await Field.findOne({ gridId, name: "Habit" }).select({ id: 1 }).lean();
  if (!habit) { log("no Habit field — run 0008 first"); return; }

  const boardMod = await Module.findOne({ gridId, role: "container", label: "Movements" }).select({ id: 1 }).lean();
  if (!boardMod) { log("no Movements board — nothing to mark"); return; }
  const board = await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ occurrences: 1 }).lean();

  const modIds = new Set();
  for (const kid of board?.occurrences || []) {
    const k = await Occurrence.findOne({ gridId, id: kid }).select({ moduleId: 1, meta: 1 }).lean();
    // Feed copies carry meta.feedSourceId and share their source's module —
    // harmless either way, but skip them so the count reads honestly.
    if (k && !k.meta?.feedSourceId) modIds.add(k.moduleId);
  }
  const need = await Module.find({
    gridId, id: { $in: [...modIds] }, "fieldBindings.fieldId": { $ne: habit.id },
  }).select({ id: 1, label: 1 }).lean();
  if (!need.length) { log(`all ${modIds.size} movement module(s) already carry the marker`); return; }
  log(`mark ${need.length} of ${modIds.size} movement module(s) as habits: ${need.slice(0,6).map(m=>m.label).join(", ")}${need.length>6?" …":""}`);
  if (dryRun) return;
  await Module.updateMany({ gridId, id: { $in: need.map(m => m.id) } },
    { $push: { fieldBindings: { fieldId: habit.id, role: "input", order: 91, hidden: true } } });
}
