// 0447 — an appointment reaches the Schedule as a COPY-LINK in its start slot
// (user, 2026-10-27).
//
// The plan, in the user's words: "if it has a date in the appointments
// container, it should be copylinked to the schedule. if i want a new
// appointment thats the same with a diff date, i copy the original appointment,
// and change the date. the op then comes and collects them and copylinks those
// appointments to the schedule."
//
// `Schedule: Place Dated Work` used to LIST the original itself in every slot
// its duration covered. Now, per day on screen:
//  - an appointment (binds Schedule Type, has a Date and a Time Slot) that is
//    not itself one of this op's copies gets one linked copy in that day's slot for its
//    Time Slot — the START slot only (user's pick: trackers count it once, as
//    they did when one row was listed in several slots). The copy carries
//    `meta.datedWork` so the sweep only ever deletes copies this op made.
//    `meta.datedWork` is what stops the op copying its own copies (an
//    `_ancestors` test would also skip an original the old op listed in a
//    slot); one made by hand inside its own slot is never copied into it.
//  - the sweep DELETES a datedWork copy whose original no longer belongs in that
//    slot (its date or time changed — a copy-link shares both, so editing either
//    copy moves both), and UNLISTS an original still listed directly in a slot
//    it is not homed in (the old placements).
// A copy-link shares every field (0445), so ticking, re-timing or re-dating
// either side changes the other. A new appointment is a plain COPY of the
// original with a new date; the op links that one in on its own day.
//
// Matched by SHAPE (the loops' `as` names), never by step id, so the seed
// builder runs the same transform and a reseed cannot drift from this.
export const id = "0447-appointments-copy-linked-into-schedule";
export const describe = "Schedule: Place Dated Work copy-links each appointment into its start slot instead of listing the original in every covered slot.";
export const touches = ["operations"];

const OP_NAME = "Schedule: Place Dated Work";
let n = 0;
const sid = () => `dw${Date.now().toString(36)}${(n++).toString(36)}`;
const act = (config) => ({ id: sid(), type: "action", config });
const rule = (left, comparator, right = "") => ({ id: sid(), left, comparator, right });
const iff = (rules, then) => ({ id: sid(), type: "if", condition: { operator: "AND", rules }, then, else: [] });

/** The steps that place one appointment ($appt) on one day ($dayColId). */
export function placeSteps({ scheduleFormatFieldId, timeslotFieldId }) {
  const f = (fid) => `fields.${fid}.value`;
  return [
    act({ type: "FIND", over: "$allContainers", itemIdVar: "$slotId", predicate: { operator: "AND", rules: [
      rule("_ancestors", "HAS_ANCESTOR", "$dayColId"),
      rule(f(scheduleFormatFieldId), "IS", "slot"),
      rule(f(timeslotFieldId), "IS", `$appt.${f(timeslotFieldId)}`),
    ] } }),
    iff([rule("$slotId", "IS_NOT_EMPTY")], [
      act({ type: "FIND", over: "$allInstances", itemIdVar: "$apptCopyId", predicate: { operator: "AND", rules: [
        rule("meta.copyLinkSource", "IS", "$appt.id"),
        rule("parentId", "IS", "$slotId"),
      ] } }),
      iff([rule("$apptCopyId", "IS_EMPTY"), rule("$appt.parentId", "IS_NOT", "$slotId")], [
        act({ type: "COPY_LINK", sourceId: "$appt.id", parent: "$slotId", recursive: false, meta: { datedWork: true }, itemIdVar: "$apptCopyId" }),
      ]),
      act({ type: "PUSH_TO_VAR", name: "$claimed", expr: "${$slotId}|${$appt.id}" }),
    ]),
  ];
}

/** The sweep body for one row ($placed) found under the day column. */
export function sweepSteps({ scheduleFormatFieldId }) {
  return [{
    id: sid(), type: "loop", overExpr: "$allContainers", as: "$sweepSlot", body: [
      iff([
        rule("$sweepSlot._ancestors", "HAS_ANCESTOR", "$dayColId"),
        rule(`$sweepSlot.fields.${scheduleFormatFieldId}.value`, "IS", "slot"),
        rule("$sweepSlot.occurrences", "CONTAINS", "$placed.id"),
      ], [
        iff([
          rule("$placed.meta.datedWork", "IS", true),
          rule("$claimed", "NOT_CONTAINS", "${$sweepSlot.id}|${$placed.meta.copyLinkSource}"),
        ], [act({ type: "DELETE", itemIdExpr: "$placed.id" })]),
        iff([
          rule("$placed.meta.copyLinkSource", "IS_EMPTY"),
          rule("$placed.parentId", "IS_NOT", "$sweepSlot.id"),
        ], [act({ type: "REMOVE_CHILD", parentId: "$sweepSlot.id", childId: "$placed.id" })]),
      ]),
    ],
  }];
}

/**
 * Pure: rewrite a Place Dated Work pipeline. Returns { pipeline, changed } —
 * `changed` names each part found, so a caller can refuse a partial match.
 */
export function copyLinkAppointments(pipeline, ids) {
  const changed = { slotLabels: 0, place: 0, sweep: 0 };
  const walkList = (list) => {
    if (!Array.isArray(list)) return list;
    const out = [];
    for (const step of list) {
      if (step?.type === "action" && step.config?.type === "INIT_VAR" && step.config.name === "$slotLabels") { changed.slotLabels++; continue; }
      if (step?.type === "loop" && step.as === "$slot" && JSON.stringify(step.body).includes("$slotLabels")) { changed.slotLabels++; continue; }
      out.push(walkStep(step));
    }
    return out;
  };
  const walkStep = (step) => {
    if (!step || typeof step !== "object") return step;
    if (step.type === "loop" && step.as === "$appt") {
      const gate = step.body?.[0];
      if (gate?.type !== "if") return step;
      changed.place++;
      const rules = (gate.condition?.rules || []).filter((r) => r.left !== "$appt.meta.datedWork");
      rules.push(rule("$appt.meta.datedWork", "IS_EMPTY"));
      return { ...step, body: [{ ...gate, condition: { ...gate.condition, rules }, then: placeSteps(ids), else: [] }, ...step.body.slice(1)] };
    }
    if (step.type === "loop" && step.as === "$placed") {
      const gate = step.body?.[0];
      if (gate?.type !== "if") return step;
      changed.sweep++;
      return { ...step, body: [{ ...gate, then: sweepSteps(ids), else: [] }, ...step.body.slice(1)] };
    }
    const out = { ...step };
    for (const k of ["then", "else", "body"]) if (Array.isArray(out[k])) out[k] = walkList(out[k]);
    if (out.config) for (const k of ["then", "else", "body", "steps"]) if (Array.isArray(out.config[k])) out.config = { ...out.config, [k]: walkList(out.config[k]) };
    return out;
  };
  return { pipeline: { ...pipeline, steps: walkList(pipeline.steps) }, changed };
}

/** Pure: the op re-runs when a Date changes (a re-dated appointment moves its copy). */
export function withDateTrigger(op, dateFieldId) {
  const triggers = op.triggerObjects || [];
  if (triggers.some((t) => t.eventType === "onChange" && t.targetId === dateFieldId)) return triggers;
  const priority = triggers.find((t) => t.eventType === "onChange")?.priority ?? 2;
  return [...triggers, { eventType: "onChange", subjectType: "field", targetId: dateFieldId, priority }];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`  "${OP_NAME}" not on this grid — skipped`); return; }
  const byName = async (name) => {
    const fs = await Field.find({ gridId, name }).lean();
    if (fs.length !== 1) throw new Error(`expected one field "${name}", found ${fs.length}`);
    return fs[0].id;
  };
  const ids = {
    scheduleFormatFieldId: await byName("Schedule Format"),
    timeslotFieldId: await byName("Time Slot"),
  };
  const dateFieldId = await byName("Date");
  const { pipeline, changed } = copyLinkAppointments(op.pipeline, ids);
  log(`  found: ${JSON.stringify(changed)}`);
  if (changed.place !== 1 || changed.sweep !== 1 || changed.slotLabels !== 2) throw new Error("the op does not have the expected shape — nothing written");
  const triggerObjects = withDateTrigger(op, dateFieldId);
  log(`  triggers ${op.triggerObjects?.length || 0} -> ${triggerObjects.length}`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline, triggerObjects } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  const s = JSON.stringify(after.pipeline);
  if (!s.includes('"datedWork"') || s.includes("SLOTS_COVERED")) throw new Error("read-back does not show the new steps");
  log("  applied. RESTART pm2.");
}
