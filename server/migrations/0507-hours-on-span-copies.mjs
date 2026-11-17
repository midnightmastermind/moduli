// 0507 — the later slots of a shift show its Hours too (follow-up to 0506, 2026-11-17). A shift's 9:30–2:30 entries
// are Duration Copies (`meta.spanOf` = the row they span, 0487) — not linked to the shift, so a value written on the
// shift does not reach them, while their module (the shift's) now binds Hours: an empty Hours box on each. "Work
// Shifts: Hours" also gives a span copy the range of the row it spans (its own Time Slot is the later slot).
import { hoursPipeline } from "./0506-shift-start-slot-and-hours.mjs";
export const id = "0507-hours-on-span-copies";
export const describe = "Work Shifts: Hours also fills Hours on a shift's Duration Copies (the 9:30–2:30 entries), from the row they span.";
export const touches = ["operations"];
const F = { slot: "nSccAtADyUGW", duration: "1wNjBBeOTwA2" };
const uid = () => Math.random().toString(36).slice(2, 14);
const rule = (left, comparator, right) => ({ id: uid(), left, comparator, right });

/** The span-copy pass. Pure. */
export function spanHoursSteps(hoursId) {
  return [{ id: "span-hours", type: "loop", overExpr: "$allInstances", as: "$sp", body: [
    { id: uid(), type: "if", condition: { operator: "AND", rules: [rule("$sp.meta.spanOf", "IS_NOT_EMPTY", "")] }, then: [
      { id: uid(), type: "action", config: { type: "FIND", over: "$allInstances", itemVar: "$spanned", predicate: { operator: "AND", rules: [rule("id", "IS", "$sp.meta.spanOf")] } } },
      { id: uid(), type: "if", condition: { operator: "AND", rules: [rule("$spanned._boundFieldIds", "ARRAY_INCLUDES", hoursId)] }, then: [
        { id: uid(), type: "action", config: { type: "TIME_RANGE", start: `$spanned.fields.${F.slot}.value`, minutes: `$spanned.fields.${F.duration}.value`, to: "$spHrs" } },
        { id: uid(), type: "if", condition: { operator: "AND", rules: [rule("$spHrs", "IS_NOT_EMPTY", ""), rule(`$sp.fields.${hoursId}.value`, "IS_NOT", "$spHrs")] },
          then: [{ id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: hoursId, occurrenceIdExpr: "$sp.id", valueExpr: "$spHrs" } }], else: [] },
      ], else: [] },
    ], else: [] },
  ] }];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Operation } = models;
  const hours = await Field.findOne({ gridId, name: "Hours" }).lean();
  const op = await Operation.findOne({ gridId, name: "Work Shifts: Hours" }).lean();
  if (!hours || !op) throw new Error("REFUSING: run 0506 first");
  const has = JSON.stringify(op.pipeline).includes('"span-hours"');
  log(`  span pass: ${has ? "already there" : "add"}`);
  if (dryRun || has) return;
  const pipeline = { ...hoursPipeline(hours.id), steps: [...hoursPipeline(hours.id).steps, ...spanHoursSteps(hours.id)] };
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline, updatedAt: new Date(),
    triggerObjects: [...op.triggerObjects, ...(op.triggerObjects.some((t) => t.eventType === "onFilterChange") ? [] : [{ eventType: "onFilterChange", subjectType: "grid", targetId: "", priority: 6 }])],
    triggerTypes: [...new Set([...(op.triggerTypes || []), "onFilterChange"])] } });
  const back = await Operation.findOne({ gridId, id: op.id }).lean();
  log(`  read back: span pass ${JSON.stringify(back.pipeline).includes('"span-hours"')}`);
}
