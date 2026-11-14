// 0499 — a Schedule day's Occasions holds EVERY row with a Schedule Type dated that day (user, 2026-11-14:
// "i need the occassions to contain … employment" · "any schedule type should be there").
//
// Before: Occasions copied Holidays (Schedule Type = Holiday, no time slot — 0453) and rows under
// Tasks › Appointments (0488). Work shifts (Employment, in Tasks › Work Shifts), classes in Done, a
// therapy session under a project… were left out. Now, inside `Schedule: Place Dated Work`:
//   1. the holiday pass takes ANY Schedule Type (and any time slot), still skipping copies — feed copies,
//      slot copies (datedWork), duration copies (spanOf) and Occasions copies themselves;
//   2. the Occasions sweep also deletes a copy whose source no longer has a Schedule Type;
//   3. the appointments pass + its own sweep (0488) are removed — the general pass covers them, and their
//      sweep ("left Appointments") would delete copies the general pass wants to keep;
//   4. the op re-runs when a Schedule Type changes.
// Copies already made by either pass stay (same source, same parent = same copy).
export const id = "0499-occasions-hold-any-schedule-type";
export const describe = "Each Schedule day's Occasions copy-links every row with a Schedule Type dated that day.";
export const touches = ["operations"];

const OP_NAME = "Schedule: Place Dated Work";
let n = 0;
const sid = () => `ost${Date.now().toString(36)}${(n++).toString(36)}`;

const walk = (steps, fn) => { for (const s of steps || []) { fn(s); walk(s.then, fn); walk(s.else, fn); walk(s.body, fn); } };

/** Pure. Returns { pipeline, triggerObjects, changed, scheduleTypeFieldId }. Idempotent; throws on an unknown shape. */
export function occasionsHoldAnyScheduleType(pipeline, triggerObjects = []) {
  const p = structuredClone(pipeline);
  let block = null;
  walk(p.steps, (s) => {
    const r = s.type === "if" && s.condition?.rules?.length === 1 ? s.condition.rules[0] : null;
    if (r && r.left === "$occasionsId" && r.comparator === "IS_NOT_EMPTY") block = block || s;
  });
  if (!block) throw new Error("Place Dated Work has no Occasions block");
  const loopAs = (as) => block.then.filter((s) => s.type === "loop" && s.as === as);
  const [hol] = loopAs("$hol");
  const [oc] = loopAs("$oc");
  if (!hol || !oc) throw new Error("Occasions block lacks the holiday pass or its sweep");

  const holIf = hol.body.find((s) => s.type === "if");
  // The Schedule Type rule: the one field rule compared with IS (IS_NOT_EMPTY once migrated) that is not the Date.
  const dateRule = holIf.condition.rules.find((r) => r.comparator === "SAME_DAY");
  const candidates = holIf.condition.rules.filter((r) => /^\$hol\.fields\.[^.]+\.value$/.test(r.left || "") && r !== dateRule && (r.comparator === "IS" || r.comparator === "IS_NOT_EMPTY"));
  if (candidates.length !== 1) throw new Error(`expected one Schedule Type rule in the holiday pass, found ${candidates.length}`);
  const typeField = /^\$hol\.fields\.([^.]+)\.value$/.exec(candidates[0].left)[1];
  const dateField = /^\$hol\.fields\.([^.]+)\.value$/.exec(dateRule.left)[1];

  let changed = false;
  // 1. any Schedule Type, any time slot, never a duration copy
  if (candidates[0].comparator !== "IS_NOT_EMPTY") { candidates[0].comparator = "IS_NOT_EMPTY"; candidates[0].right = ""; changed = true; }
  const before = holIf.condition.rules.length;
  holIf.condition.rules = holIf.condition.rules.filter((r) => !(r.comparator === "IS_EMPTY" && /^\$hol\.fields\.[^.]+\.value$/.test(r.left || "")
    && r.left !== `$hol.fields.${typeField}.value`));
  if (holIf.condition.rules.length !== before) changed = true;
  if (!holIf.condition.rules.some((r) => r.left === "$hol.meta.spanOf")) {
    holIf.condition.rules.push({ id: sid(), left: "$hol.meta.spanOf", comparator: "IS_EMPTY", right: "" }); changed = true;
  }
  // 2. the sweep keeps a copy only while its source still has a Schedule Type
  const ocIf = oc.body.find((s) => s.type === "if");
  const keep = ocIf?.then?.find((s) => s.type === "if" && (s.condition?.rules || []).some((r) => r.left === `$ocSrc.fields.${dateField}.value`));
  if (!keep) throw new Error("Occasions sweep has an unexpected shape");
  if (!keep.condition.rules.some((r) => r.left === `$ocSrc.fields.${typeField}.value`)) {
    keep.condition.rules.push({ id: sid(), left: `$ocSrc.fields.${typeField}.value`, comparator: "IS_NOT_EMPTY", right: "" }); changed = true;
  }
  // 3. the appointments pass and its sweep go
  const drop = new Set([...loopAs("$ap"), ...loopAs("$oa")]);
  if (drop.size) { block.then = block.then.filter((s) => !drop.has(s)); changed = true; }
  // 4. re-run when a Schedule Type changes
  let triggers = triggerObjects;
  if (!triggers.some((t) => t.eventType === "onChange" && t.subjectType === "field" && t.targetId === typeField)) {
    const priority = triggers.find((t) => t.eventType === "onChange")?.priority ?? 2;
    triggers = [...triggers, { eventType: "onChange", subjectType: "field", targetId: typeField, priority }];
    changed = true;
  }
  return { pipeline: p, triggerObjects: triggers, changed, scheduleTypeFieldId: typeField };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const ops = await Operation.find({ gridId, name: OP_NAME }).lean();
  if (ops.length !== 1) { log(`  ${ops.length} "${OP_NAME}" ops — nothing to do`); return; }
  const op = ops[0];
  const r = occasionsHoldAnyScheduleType(op.pipeline, op.triggerObjects || []);
  log(`  Schedule Type field ${r.scheduleTypeFieldId} · changed: ${r.changed} · triggers ${op.triggerObjects?.length || 0} -> ${r.triggerObjects.length}`);
  if (!r.changed || dryRun) return { changed: r.changed };
  await Operation.updateOne({ gridId, id: op.id }, { $set: {
    pipeline: r.pipeline, triggerObjects: r.triggerObjects,
    triggerTypes: [...new Set(r.triggerObjects.map((t) => t.eventType))], updatedAt: new Date(),
  } });
  return { changed: true };
}
