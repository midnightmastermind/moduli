// server/migrations/0396-reminder-and-schedule-fields.mjs
//
// The user, 2026-10-12: "a field named reminder thats a date and time or an interval … that sets
// reminders in the alarms area" and "a field called schedule that takes a date and time or interval,
// that adds it to that day in the schedule (using the op)".
//
// Creates two `when` fields — Reminder (meta.reminder: the client keeps one Alarms-list entry per value)
// and Schedule — and the operation that places anything holding a Schedule value onto each day it falls on:
// `Schedule: Place Scheduled Items`, the shape of `Schedule: Place Weekday Tasks` (same triggers, same
// day-column and slot lookups, same APPLY_TEMPLATE merge, so a second pass recognises what it placed)
// with the weekday test replaced by WHEN_ON_DAY and the slot read from the value (WHEN_SLOTS).
// Ids come from grid.meta.scheduleFieldIds; nothing is hardcoded.

export const id = "0396-reminder-and-schedule-fields";
export const describe = "Reminder + Schedule fields (type when) and the op that places Schedule values on their days.";
export const touches = ["fields", "operations"];

const uid = () => globalThis.crypto.randomUUID();
const r = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
const and = (...rules) => ({ operator: "AND", rules });
const act = (config) => ({ id: uid(), type: "action", config });
const iff = (condition, then, els = []) => ({ id: uid(), type: "if", condition, then, else: els });
const loop = (overExpr, as, body) => ({ id: uid(), type: "loop", overExpr, as, body });

/** PURE. The placing pipeline, from the grid's schedule field ids and the Schedule field's id. */
export function placeScheduledPipeline({ pageOccurrenceId, dateFieldId, timeslotFieldId, scheduleFormatFieldId, scheduleFieldId }) {
  const val = (fid) => `$task.fields.${fid}.value`;
  const apply = (target, slotExpr) => act({ type: "APPLY_TEMPLATE", templateRef: "$task.id", rootParent: target, mode: "merge",
    defaultFields: { [dateFieldId]: "$day", ...(slotExpr ? { [timeslotFieldId]: slotExpr } : {}) } });
  return { sources: [], steps: [
    act({ type: "INIT_VAR", name: "$schedPage", expr: `$allItemsById.${pageOccurrenceId}` }),
    act({ type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }),
    iff(and(r("$schedPageId", "IS_NOT_EMPTY"),
      { id: uid(), operator: "OR", rules: [r("$trigger.sourceOccurrenceId", "IS_EMPTY"), r("$trigger.sourceOccurrenceId", "IS", "$schedPage.id")] }), [
      loop("$activePeriodDates", "$day", [
        act({ type: "FIND", over: "$allContainers", itemIdVar: "$dayColId", predicate: and(
          r("_ancestors", "HAS_ANCESTOR", "$schedPageId"), r(`fields.${scheduleFormatFieldId}.value`, "IS", "day-col"),
          r(`fields.${dateFieldId}.value`, "SAME_DAY", "$day")) }),
        iff(and(r("$dayColId", "IS_NOT_EMPTY")), [
          act({ type: "FIND", over: "$allContainers", itemIdVar: "$todoId", predicate: and(
            r("parentId", "IS", "$dayColId"), r(`fields.${timeslotFieldId}.value`, "IS", "Todo")) }),
          loop("$allInstances", "$task", [
            iff(and(r(val(scheduleFieldId), "WHEN_ON_DAY", "$day"), r(val(dateFieldId), "IS_EMPTY"), r("$task.meta.feedSourceId", "IS_EMPTY")), [
              act({ type: "WHEN_SLOTS", when: val(scheduleFieldId), day: "$day", to: "$slots" }),
              // an all-day value goes in the day's Todo
              iff(and(r("$slots", "IS_EMPTY"), r("$todoId", "IS_NOT_EMPTY")), [apply("$todoId", null)]),
              loop("$slots", "$slotTime", [
                act({ type: "SET_VAR", name: "$targetId", value: "$todoId" }),
                act({ type: "FIND", over: "$allContainers", itemIdVar: "$slotId", predicate: and(
                  r("parentId", "IS", "$dayColId"), r(`fields.${timeslotFieldId}.value`, "IS", "$slotTime")) }),
                iff(and(r("$slotId", "IS_NOT_EMPTY")), [act({ type: "SET_VAR", name: "$targetId", value: "$slotId" })]),
                iff(and(r("$targetId", "IS_NOT_EMPTY")), [apply("$targetId", "$slotTime")]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Field, Operation } = models;
  const grid = await Grid.findById(gridId).lean();
  const ids = grid?.meta?.scheduleFieldIds;
  if (!ids?.pageOccurrenceId || !ids.dateFieldId || !ids.timeslotFieldId || !ids.scheduleFormatFieldId)
    throw new Error("0396: grid.meta.scheduleFieldIds is incomplete — set it in Grid settings › Schedule first");
  const ensure = async (name, meta) => {
    const found = await Field.findOne({ gridId, name }).lean();
    if (found) {
      if (found.type !== "when") throw new Error(`0396: a field named ${name} exists with type ${found.type}`);
      log(`field ${name} exists`); return found;
    }
    const doc = { id: uid(), userId: String(grid.userId), gridId, name, type: "when", inputEnabled: true, displayEnabled: false, meta };
    log(`+ field ${name} (when)`);
    if (!dryRun) await Field.create(doc);
    return doc;
  };
  await ensure("Reminder", { reminder: true });
  const sched = await ensure("Schedule", {});
  const name = "Schedule: Place Scheduled Items";
  if (await Operation.findOne({ gridId, name }).lean()) { log(`op ${name} exists`); return; }
  const op = {
    id: uid(), userId: String(grid.userId), gridId, name, enabled: true, priority: 3,
    description: "Places every item holding a Schedule value on each day it falls on (a copy per day, dated).",
    triggerObjects: [
      { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "grid", targetId: "", priority: 3 },
      { eventType: "onFilterChange", subjectType: "filterNav", targetId: "", priority: 3 },
      { eventType: "onChange", subjectType: "field", targetId: sched.id, priority: 3 },
    ],
    triggerTypes: ["onLoad", "onFilterChange", "onChange"], triggerType: "onLoad",
    pipeline: placeScheduledPipeline({ ...ids, scheduleFieldId: sched.id }),
  };
  log(`+ op ${name}`);
  if (!dryRun) await Operation.create(op);
}
