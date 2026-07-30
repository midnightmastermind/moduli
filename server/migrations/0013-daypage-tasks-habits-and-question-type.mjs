// User, 2026-07-30: "dont include sleep in the tasks completed", "i thought we got
// rid of duration for that … sleep", and the still-open Daily Question header
// reading "(no options — check pool predicate)".
//
// Three separate defects, one pass:
//
// 1. Tasks Completed listed HABITS. A day of half-hour sleep slots is 11+ completed
//    occurrences and they filled the whole section. The section is TASKS; habits are
//    counted by Completed Habits. Rebuilt with the habit-marker rule, using the same
//    module-BINDING discriminator the two trackers use (2026-07-11 idiom) — never a
//    stored value, which would count a bound-but-unchecked item.
//
// 2. Sleep binds Duration again. Migration 0007 unbound it and cleared the values;
//    the binding is back on the routine module (order 94, added after the migration
//    ran) and one occurrence carries a value. A slot IS 30 minutes, so a duration on
//    top double-counts. Unbind + clear, matching the seed. Found STRUCTURALLY (the
//    instance module labelled Sleep that carries the Habit marker — there are two
//    "Sleep" modules; the other is the tracker tile that legitimately binds Sleep
//    Time), so it can't hit the wrong one the way a bare findOne could.
//
// 3. Daily Question resolved ZERO options despite a valid 117-question pool, because
//    the FIELD IS TYPE "text" — `resolveOptions` returns nothing for any type other
//    than select/occurrence on its FIRST line, so the pool never mattered. Everything
//    the previous session ruled out (inputEnabled, the predicate, the call site) was
//    genuinely fine. Measured by running the real resolver against this grid's data:
//    predicate matched 117 records, resolveOptions returned 0.

import { makeDayPageBuildTasksCompletedOp } from "../utils/liveSystemBuilders.js";

export const id = "0013-daypage-tasks-habits-and-question-type";
export const describe =
  "Rebuilds Day Page: Build Tasks Completed so it excludes habits (Sleep and the other routines), " +
  "unbinds Duration from the Sleep routine and clears its stored values, and switches the Daily " +
  "Question field from text to select so its 117-question pool resolves.";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation } = models;
  const userId = grid.userId;

  // ── 1. Tasks Completed excludes habits ────────────────────────────────────
  const sched = grid?.meta?.scheduleFieldIds || {};
  const dateFieldId = sched.dateFieldId;
  const schedulePageOccId = sched.pageOccurrenceId;
  const completed = await Field.findOne({ gridId, name: "Completed" }).select({ id: 1 }).lean();
  const habit = await Field.findOne({ gridId, name: "Habit" }).select({ id: 1 }).lean();
  if (!dateFieldId || !schedulePageOccId || !completed || !habit) {
    throw new Error("missing scheduleFieldIds / Completed / Habit — cannot rebuild the Tasks Completed op");
  }

  const tcOp = await Operation.findOne({ gridId, name: "Day Page: Build Tasks Completed" }).lean();
  if (!tcOp) log("no 'Day Page: Build Tasks Completed' op on this grid — skipping the rebuild");
  else {
    const already = JSON.stringify(tcOp.pipeline).includes(habit.id);
    if (already) log("Tasks Completed already excludes habits");
    else {
      const rebuilt = makeDayPageBuildTasksCompletedOp({
        userId, gridId, dateFieldId, completedFieldId: completed.id,
        schedulePageOccId, habitFieldId: habit.id,
      });
      log(`rebuild 'Day Page: Build Tasks Completed' with the habit exclusion (${habit.id})`);
      if (!dryRun) {
        // Keep the op's OWN id/name/triggers — only the pipeline changes, so
        // anything referencing this operation by id keeps working.
        await Operation.updateOne({ gridId, id: tcOp.id }, { $set: { pipeline: rebuilt.pipeline } });
      }
    }
  }

  // ── 2. Sleep loses Duration (again) ───────────────────────────────────────
  const duration = await Field.findOne({ gridId, name: "Duration" }).select({ id: 1 }).lean();
  if (!duration) log("no Duration field — skipping the Sleep change");
  else {
    // The ROUTINE Sleep is the instance module that binds the hidden Habit marker.
    // The other "Sleep" is the tracker tile (binds Sleep Time) and must not be touched.
    const sleeps = await Module.find({ gridId, role: "instance", label: "Sleep" }).select({ id: 1, fieldBindings: 1 }).lean();
    const routine = sleeps.find(m => (m.fieldBindings || []).some(b => b.fieldId === habit.id));
    if (!routine) log("no routine Sleep module (none carries the Habit marker) — skipping");
    else if (!(routine.fieldBindings || []).some(b => b.fieldId === duration.id)) log("Sleep already has no Duration binding");
    else {
      const valued = await Occurrence.countDocuments({ gridId, moduleId: routine.id, [`fields.${duration.id}`]: { $exists: true } });
      log(`unbind Duration from the Sleep routine (${routine.id}) + clear ${valued} stored value(s)`);
      if (!dryRun) {
        await Module.updateOne({ gridId, id: routine.id }, { $pull: { fieldBindings: { fieldId: duration.id } } });
        await Occurrence.updateMany(
          { gridId, moduleId: routine.id, [`fields.${duration.id}`]: { $exists: true } },
          { $unset: { [`fields.${duration.id}`]: "" } });
      }
    }
  }

  // ── 3. Daily Question becomes a select ────────────────────────────────────
  const dq = await Field.findOne({ gridId, name: "Daily Question" }).select({ id: 1, type: 1 }).lean();
  if (!dq) log("no Daily Question field — skipping");
  else if (dq.type === "select") log("Daily Question is already a select");
  else {
    log(`Daily Question: type "${dq.type}" → "select" (so its option pool resolves)`);
    if (!dryRun) await Field.updateOne({ gridId, id: dq.id }, { $set: { type: "select" } });
  }
}
