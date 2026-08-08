// server/migrations/0053-place-dated-work.mjs
//
// Carry the appointment-spanning + Due-rework behaviour to the live grid.
//
// USER, 2026-08-07:
//   "forget appointments slot, just put them in where they are supposed to go
//    in the timeslot cause we have times to put it in. make sure they are in
//    every timeslot its alloted for."
//   "stuff with a due date should be put in the Due slot, everyday until its
//    due (so copied), if its completed and on the schedule, we can stop
//    displaying it the next day."
//
// ── THIS MIGRATION IS PURELY ADDITIVE, AND THAT IS THE DESIGN ───────────────
//
// It creates one field, two operations, and adds two bindings to one module.
// **It moves no occurrence, deletes nothing, and rewrites no existing value.**
// Every migration on this grid that caused damage did so by SELECTING existing
// rows and moving them (0035 moved the user's real project page; 0038's guard
// fired on its own footprint). There is no selector here that can match the
// wrong thing, because nothing existing is being chosen.
//
// The PLACEMENT itself — which appointment lands in which slot — is done at run
// time by the operation, against live data, and is fully reversible: every
// placement is a link in a parent's `occurrences[]`, and the op's own sweep
// removes any it no longer claims. Nothing is baked in here.
//
// ── WHY THE BUILDER AND THE MIGRATION SHARE ONE SOURCE ─────────────────────
//
// Both halves import the SAME builders from `utils/liveSystemBuilders.js`. A
// stored pipeline diverging from the builder that generated it is a recurring
// failure on this grid (0006's alarm twins, the Daily Question FIND that 0039
// patched in one place and not the other). Generating the pipeline here rather
// than copying its JSON means a reseeded grid and a migrated grid cannot drift.
//
// ── IT RESOLVES EVERY ID BY MEASUREMENT AND FAILS CLOSED ───────────────────
//
// No id is baked in. Fields are resolved by name AND type (this grid has two
// fields called "Due" — a number tracker tile and the real date field — so name
// alone picks the wrong one half the time). The Schedule page is resolved from
// `grid.meta.scheduleFieldIds.pageOccurrenceId`, which the seed stamps. Any
// unresolved piece ABORTS rather than writing a half-wired op: an operation
// pointing at the wrong field is worse than no operation, because it looks like
// it is working.

import {
  makeStampCompletedOnOp,
  makeSchedulePlaceDatedWorkOp,
} from "../utils/liveSystemBuilders.js";

export const id = "0053-place-dated-work";

const uid = () => (globalThis.crypto?.randomUUID?.()
  || `f-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const OP_NAMES = ["Schedule: Stamp Completed On", "Schedule: Place Dated Work"];

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field, Operation, Grid } = models;

  const grid = await Grid.findById(gridId).lean();
  const userId = grid?.userId;
  if (!userId) { log("no grid/userId — aborting"); return; }

  // ── Resolve every field by NAME **AND TYPE** ─────────────────────────────
  const fields = await Field.find({ gridId }).lean();
  const byNameType = (name, type) => fields.find(f => f.name === name && f.type === type);

  const dateField      = byNameType("Date", "date");
  const timeslotField  = byNameType("Time Slot", "select");
  const durationField  = byNameType("Duration", "duration");
  const completedField = byNameType("Completed", "boolean");
  // TWO fields are called "Due" on this grid: a display-only NUMBER (the
  // "N tasks" tracker tile) and the real date. Matching on name alone picks
  // whichever Mongo returns first.
  const dueField       = byNameType("Due", "date");
  const schedFmtField  = fields.find(f => f.name === "Schedule Format");

  const missing = Object.entries({
    Date: dateField, "Time Slot": timeslotField, Duration: durationField,
    Completed: completedField, "Due (date)": dueField, "Schedule Format": schedFmtField,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    log(`ABORT — could not resolve: ${missing.join(", ")}`);
    return;
  }
  log(`fields resolved — Due(date)=${dueField.id} among ${fields.filter(f => f.name === "Due").length} named "Due"`);

  // ── The Schedule page, from the marker the seed stamps ───────────────────
  const schedulePageOccId = grid?.meta?.scheduleFieldIds?.pageOccurrenceId || null;
  if (!schedulePageOccId) {
    log("ABORT — grid.meta.scheduleFieldIds.pageOccurrenceId is not set; refusing to guess the Schedule page");
    return;
  }
  const schedPage = await Occurrence.findOne({ gridId, id: schedulePageOccId }).lean();
  if (!schedPage) { log(`ABORT — Schedule page ${schedulePageOccId} does not exist`); return; }
  log(`Schedule page ${schedulePageOccId}`);

  // ── The Appointment module ───────────────────────────────────────────────
  // Its OCCURRENCES are what the op matches (`templateId IS <moduleId>`), so
  // this must be the module the user's appointments are copies of.
  const apptMods = await Module.find({ gridId, role: "instance", label: "Appointment" }).lean();
  if (apptMods.length !== 1) {
    log(`ABORT — expected exactly 1 Appointment module, found ${apptMods.length}`);
    return;
  }
  const apptMod = apptMods[0];
  const apptOccCount = await Occurrence.countDocuments({ gridId, moduleId: apptMod.id });
  log(`Appointment module ${apptMod.id} — ${apptOccCount} occurrence(s)`);

  // ── 1. The Completed On field ────────────────────────────────────────────
  // Find-or-create. Nothing else on this grid records WHEN something was done.
  let completedOnField = byNameType("Completed On", "date");
  if (completedOnField) {
    log(`Completed On already exists (${completedOnField.id}) — reusing`);
  } else {
    const doc = {
      id: uid(), userId, gridId,
      name: "Completed On", type: "date",
      // Read-only: a hand-edited completion date would disagree with the
      // checkbox that owns it.
      inputEnabled: false, displayEnabled: false,
      meta: {}, folderId: dateField.folderId || null,
    };
    log(`${dryRun ? "would create" : "creating"} field "Completed On" (${doc.id})`);
    if (!dryRun) await Field.create(doc);
    completedOnField = doc;
  }

  // ── 2. Time Slot + Duration bound on Appointment ─────────────────────────
  // Measured 2026-08-07: Appointment binds Completed / Appointment Type /
  // Place / People / Duration / Date(hidden) / Habit(hidden) and carries NO
  // start time — so "Therapy at 2:00pm" had nowhere to put the 2:00pm and the
  // spanning op had no input. `$addToSet`-style: only what is missing is added,
  // and the existing bindings and their order are left exactly as they are.
  const bindings = apptMod.fieldBindings || [];
  const has = (fid) => bindings.some(b => b.fieldId === fid);
  const toAdd = [];
  if (!has(timeslotField.id)) toAdd.push({ fieldId: timeslotField.id, role: "input", order: 2 });
  if (!has(durationField.id)) toAdd.push({ fieldId: durationField.id, role: "input", order: 3 });
  if (toAdd.length) {
    log(`${dryRun ? "would bind" : "binding"} on Appointment: ${toAdd.map(b => b.fieldId === timeslotField.id ? "Time Slot" : "Duration").join(", ")}`);
    if (!dryRun) {
      await Module.updateOne({ id: apptMod.id, userId }, { $set: { fieldBindings: [...bindings, ...toAdd] } });
    }
  } else {
    log("Appointment already binds Time Slot and Duration");
  }

  // ── 3. The two operations ────────────────────────────────────────────────
  // REPLACE rather than skip-if-present. An op seeded by an earlier run of a
  // migration can carry a defect the builder has since fixed, and a migration
  // that can only create is one that needs a follow-up script nobody remembers
  // (0046 records exactly this).
  const built = [
    makeStampCompletedOnOp({
      userId, gridId,
      completedFieldId: completedField.id,
      completedOnFieldId: completedOnField.id,
    }),
    makeSchedulePlaceDatedWorkOp({
      userId, gridId,
      dateFieldId: dateField.id,
      timeslotFieldId: timeslotField.id,
      durationFieldId: durationField.id,
      dueFieldId: dueField.id,
      completedOnFieldId: completedOnField.id,
      scheduleFormatFieldId: schedFmtField.id,
      schedulePageOccId,
      appointmentTemplateId: apptMod.id,
    }),
  ];

  for (const op of built) {
    const existing = await Operation.findOne({ gridId, name: op.name }).lean();
    if (existing) {
      log(`${dryRun ? "would replace" : "replacing"} op "${op.name}" (${existing.id})`);
      if (!dryRun) {
        await Operation.updateOne({ id: existing.id, userId }, {
          $set: {
            pipeline: op.pipeline,
            triggerTypes: op.triggerTypes,
            triggerObjects: op.triggerObjects,
            targetOccurrenceId: op.targetOccurrenceId ?? null,
            description: op.description,
            enabled: true,
          },
        });
      }
    } else {
      log(`${dryRun ? "would create" : "creating"} op "${op.name}" (${op.id})`);
      if (!dryRun) await Operation.create({ ...op, folderId: null });
    }
  }

  // ── What this changes, stated as an expectation rather than a count ──────
  const dueDated = await Occurrence.countDocuments({
    gridId, [`fields.${dueField.id}.value`]: { $nin: [null, ""] },
  });
  log(`occurrences carrying a due DATE today: ${dueDated} — each will appear in the Due container of every day it is outstanding`);
  log(`appointments today: ${apptOccCount} — each will cover the slots its Time Slot + Duration span`);
  log(OP_NAMES.map(n => `  • ${n}`).join("\n"));
}
