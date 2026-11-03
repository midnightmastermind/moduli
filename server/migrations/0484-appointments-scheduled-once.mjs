// 0484 — an appointment is put on the Schedule ONCE; a copy you move or delete stays that way (user, 2026-11-03).
//
// What happened: "Medication Management with Angela Soto" sat in Tasks › Appointments with a copy-link in today's
// 9:30am slot (0447). Dragging that copy to 10:00am stamped Time Slot on it (Stamp Date & Time Slot), the copy-link
// shared the new Time Slot with the original, and `Schedule: Route by Timeslot` — onChange Time Slot, "move the row
// into its slot" — moved the ORIGINAL out of Tasks into 10:00am. Place Dated Work then made a fresh 9:30am copy; the
// user deleted it and the next run made another, because nothing remembered that the appointment had been placed.
// The user: "if i move something to a diff time, it should change the timeslot on the appointment (through
// copylink). also it shouldnt delete the original if i delete it from schedule" · "if i delete it from schedule, it
// shouldnt show up again in that scheduled spot" · "a new field called scheduled that shows on the copylink that it
// was scheduled at some point" · answer: placed again only when its Date or Time Slot changes.
//
//  1. Field **Scheduled** (yes/no), bound VISIBLY on every instance module that binds Schedule Type (the appointment
//     shape 0447 places). A copy-link shares the module and every field, so the copy shows it too.
//  2. Place Dated Work: an appointment whose Scheduled is ticked gets no new copy; when its copy is in its slot
//     (found or just made), Scheduled is ticked. So deleting the copy leaves it ticked and it does not come back.
//  3. New op **Schedule: Unschedule on Date/Time Change** (onChange Date + Time Slot, priority 1 — before Place Dated
//     Work's 2): unticks Scheduled on the row that changed. Moving the copy to 10:00am changes Time Slot → unticked →
//     Place Dated Work finds the copy already in 10:00am and ticks it again; re-dating an appointment places it on
//     its new day.
//  4. Route by Timeslot never moves an appointment that lives outside the Schedule (it binds Schedule Type and is not
//     under the Schedule page) — Place Dated Work owns those. Anything else moves as before.
// Matched by shape, refuses a partial match; idempotent.
export const id = "0484-appointments-scheduled-once";
export const describe = "Appointments: a Scheduled field; Place Dated Work places each once (a deleted copy stays deleted), Date/Time changes unschedule it; Route by Timeslot leaves Tasks appointments in Tasks.";
export const touches = ["fields", "modules", "operations"];

import { randomUUID } from "node:crypto";

const PLACE = "Schedule: Place Dated Work";
const ROUTE = "Schedule: Route by Timeslot";
const UNSCHED = "Schedule: Unschedule on Date/Time Change";
let n = 0;
const sid = () => `sc${Date.now().toString(36)}${(n++).toString(36)}`;
const rule = (left, comparator, right = "") => ({ id: sid(), left, comparator, right });
const act = (config) => ({ id: sid(), type: "action", config });

const isPlaceGate = (s) => s?.type === "if" && (s.condition?.rules || []).some((r) => r.left === "$apptCopyId" && r.comparator === "IS_EMPTY")
  && (s.condition?.rules || []).some((r) => r.left === "$appt.parentId" && r.comparator === "IS_NOT");

/** Pure: Place Dated Work with the Scheduled rule. Returns { pipeline, changed }. */
export function placeOnce(pipeline, scheduledFieldId) {
  const path = `$appt.fields.${scheduledFieldId}.value`;
  let changed = 0;
  const walkList = (list) => {
    if (!Array.isArray(list)) return list;
    const out = [];
    for (const step of list) {
      if (isPlaceGate(step)) {
        changed++;
        const rules = step.condition.rules.some((r) => r.left === path) ? step.condition.rules : [...step.condition.rules, rule(path, "IS_NOT", true)];
        out.push({ ...step, condition: { ...step.condition, rules } });
        const tick = { id: sid(), type: "if", condition: { operator: "AND", rules: [rule("$apptCopyId", "IS_NOT_EMPTY"), rule(path, "IS_NOT", true)] },
          then: [act({ type: "UPDATE", path, value: true })], else: [], meta: { scheduledTick: true } };
        out.push(tick);
        continue;
      }
      if (step?.meta?.scheduledTick) continue; // re-run: the tick is re-made right after its gate
      out.push(walkStep(step));
    }
    return out;
  };
  const walkStep = (step) => {
    if (!step || typeof step !== "object") return step;
    const out = { ...step };
    for (const k of ["then", "else", "body"]) if (Array.isArray(out[k])) out[k] = walkList(out[k]);
    return out;
  };
  return { pipeline: { ...pipeline, steps: walkList(pipeline?.steps) }, changed };
}

/** Pure: Route by Timeslot leaves an appointment outside the Schedule where it is. */
export function routeSkipsAppointments(pipeline, { schedulePageId, scheduleTypeFieldId }) {
  const steps = pipeline?.steps || [];
  const gate = steps[0];
  if (gate?.type !== "if" || !(gate.condition?.rules || []).some((r) => r.left === "$trigger.value")) return { pipeline, changed: 0 };
  if ((gate.then || [])[0]?.meta?.routeItem) return { pipeline, changed: 0 };
  const find = { ...act({ type: "FIND", over: "$allInstances", itemVar: "$routeItem", predicate: { operator: "AND", rules: [rule("id", "IS", "$trigger.occurrenceId")] } }), meta: { routeItem: true } };
  const guard = { id: sid(), type: "if", meta: { routeItem: true }, condition: { operator: "OR", rules: [
    rule("$routeItem._ancestors", "HAS_ANCESTOR", schedulePageId),
    rule("$routeItem._boundFieldIds", "ARRAY_NOT_INCLUDES", scheduleTypeFieldId),
  ] }, then: gate.then || [], else: [] };
  return { pipeline: { ...pipeline, steps: [{ ...gate, then: [find, guard] }, ...steps.slice(1)] }, changed: 1 };
}

/** Pure: the unschedule op's pipeline. */
export function unschedulePipeline(scheduledFieldId) {
  return { sources: [], steps: [
    act({ type: "FIND", over: "$allInstances", itemVar: "$item", predicate: { operator: "AND", rules: [rule("id", "IS", "$trigger.occurrenceId")] } }),
    { id: sid(), type: "if", condition: { operator: "AND", rules: [rule(`$item.fields.${scheduledFieldId}.value`, "IS", true)] },
      then: [act({ type: "UPDATE", path: `$item.fields.${scheduledFieldId}.value`, value: false })], else: [] },
  ] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Operation, Occurrence, Grid } = models;
  const place = await Operation.findOne({ gridId, name: PLACE }).lean();
  if (!place) { log(`  no "${PLACE}" — nothing to do`); return; }
  const route = await Operation.findOne({ gridId, name: ROUTE }).lean();
  const one = async (name, type) => {
    const fs = await Field.find({ gridId, name, ...(type ? { type } : {}) }).lean();
    if (fs.length !== 1) throw new Error(`expected one field "${name}", found ${fs.length}`);
    return fs[0];
  };
  const schedType = await one("Schedule Type");
  const date = await one("Date", "date");
  const slot = await one("Time Slot");
  const grid = await Grid.findById(gridId).lean();
  const now = new Date();

  // 1. the field + bindings
  let scheduled = await Field.findOne({ gridId, name: "Scheduled", type: "boolean" }).lean();
  const newField = !scheduled;
  if (newField) scheduled = { id: randomUUID(), userId: String(grid.userId), gridId, name: "Scheduled", type: "boolean",
    folderId: schedType.folderId || null, inputEnabled: true, displayEnabled: false, meta: {}, createdAt: now, updatedAt: now };
  const mods = await Module.find({ gridId, role: "instance", "fieldBindings.fieldId": schedType.id }).lean();
  const toBind = mods.filter((m) => !(m.fieldBindings || []).some((b) => b.fieldId === scheduled.id));

  // 2. Place Dated Work
  const placed = placeOnce(place.pipeline, scheduled.id);
  if (placed.changed !== 1) throw new Error(`REFUSING: found ${placed.changed} placement gates in "${PLACE}" (want 1)`);

  // 4. Route by Timeslot (the Schedule page id is the one Place Dated Work names)
  const schedulePageId = /"\$allItemsById\.([^"]+)"/.exec(JSON.stringify(place.pipeline))?.[1];
  if (!schedulePageId || !(await Occurrence.exists({ gridId, id: schedulePageId }))) throw new Error("REFUSING: Schedule page not found in Place Dated Work");
  const routed = route ? routeSkipsAppointments(route.pipeline, { schedulePageId, scheduleTypeFieldId: schedType.id }) : { changed: 0 };

  // 3. the unschedule op
  const existing = await Operation.findOne({ gridId, name: UNSCHED }).lean();
  const triggerObjects = [date.id, slot.id].map((fid) => ({ eventType: "onChange", subjectType: "field", targetId: fid, priority: 1 }));

  log(`  Scheduled field: ${newField ? "new" : "exists"} ${scheduled.id}; bind on ${toBind.length} of ${mods.length} modules (${toBind.map((m) => m.label).join(", ")})`);
  log(`  ${PLACE}: gate patched; ${ROUTE}: ${route ? (routed.changed ? "guarded" : "already guarded") : "absent"}; ${UNSCHED}: ${existing ? "exists" : "new"}`);
  if (dryRun) return;

  if (newField) await Field.create(scheduled);
  for (const m of toBind) await Module.updateOne({ gridId, id: m.id }, { $push: { fieldBindings: { fieldId: scheduled.id, role: "input", order: (m.fieldBindings || []).length } }, $set: { updatedAt: now } });
  await Operation.updateOne({ gridId, id: place.id }, { $set: { pipeline: placed.pipeline, updatedAt: now } });
  if (routed.changed) await Operation.updateOne({ gridId, id: route.id }, { $set: { pipeline: routed.pipeline, updatedAt: now } });
  if (!existing) await Operation.create({ id: randomUUID(), userId: String(grid.userId), gridId, name: UNSCHED, folderId: place.folderId || null,
    description: "Unticks Scheduled when an appointment's Date or Time Slot changes, so Place Dated Work puts it on its new day / time (0484).",
    pipeline: unschedulePipeline(scheduled.id), triggerObjects, triggerTypes: ["onChange"], triggerType: "onChange", enabled: true, createdAt: now, updatedAt: now });

  const back = await Operation.findOne({ gridId, id: place.id }).lean();
  if (placeOnce(back.pipeline, scheduled.id).changed !== 1 || !JSON.stringify(back.pipeline).includes(`$appt.fields.${scheduled.id}.value`)) throw new Error("readback: Place Dated Work not patched");
  if (!(await Operation.exists({ gridId, name: UNSCHED }))) throw new Error("readback: unschedule op missing");
  log("  applied and read back — RESTART pm2.");
}
