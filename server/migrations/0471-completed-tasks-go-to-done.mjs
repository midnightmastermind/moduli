// 0471 — ticking a task's Completed sends it to the Tasks page's Done section (user, 2026-10-31: "send completed
// stuff to then done container again (but doesnt hide them until end of day)").
//   - "Tasks: Completed to Done" (onChange Completed): a ticked task under the Tasks page MOVES into Done and
//     remembers where it came from (`meta.doneFrom`). Ticked on its Schedule copy, it finds the original through
//     the copy's link group. Unticked while in Done, it moves back and its Done / Done Since are cleared.
//   - Done already stays visible until the day is over (0443's "Tasks: Mark Done" marks it after midnight and the
//     section's filter hides it then).
//   - "Schedule: Place Dated Work" copied only rows IN Tasks › Todo into each day's Todo, and swept a copy whose
//     source left Todo — so a task completed today would vanish from today's schedule at once. Each of its three
//     "parentId IS <Todo>" rules now also accepts "parentId IS <Done> AND meta.doneFrom IS <Todo>"; IS_DUE_ON
//     (Completed On) already ends the copy after the completed day.
import { randomUUID } from "node:crypto";
export const id = "0471-completed-tasks-go-to-done";
export const describe = "Ticking Completed moves a task into Tasks › Done (unticking moves it back); a Todo task completed today keeps its schedule copy for the day.";
export const touches = ["operations"];

const TODO = "542da7cf-79a9-4a85-be33-cce33327aa72";
const DONE = "eac2cc53-c04f-403e-ac01-dd0d76bb8f19";
const COMPLETED = "tZWiPDQUDP74";
const OP_NAME = "Tasks: Completed to Done";
const PDW = "Schedule: Place Dated Work";

/** Pure: every `<x>.parentId IS TODO` rule in the pipeline becomes OR(it, x in Done and came from Todo). */
export function acceptDoneFromTodo(pipeline) {
  let changed = 0;
  const fix = (rules) => (rules || []).map((r) => {
    if (r?.rules) return { ...r, rules: fix(r.rules) };
    const m = /^(\$\w+)\.parentId$/.exec(r?.left || "");
    if (!m || r.comparator !== "IS" || r.right !== TODO) return r;
    changed += 1;
    const v = m[1];
    return { id: `${r.id}-or`, operator: "OR", rules: [r, { id: `${r.id}-done`, operator: "AND", rules: [
      { id: `${r.id}-d1`, left: `${v}.parentId`, comparator: "IS", right: DONE },
      { id: `${r.id}-d2`, left: `${v}.meta.doneFrom`, comparator: "IS", right: TODO },
    ] }] };
  });
  const walk = (steps) => (steps || []).map((s) => {
    const out = { ...s };
    if (s.condition?.rules) out.condition = { ...s.condition, rules: fix(s.condition.rules) };
    for (const k of ["then", "else", "body", "steps"]) if (Array.isArray(s[k])) out[k] = walk(s[k]);
    return out;
  });
  if (JSON.stringify(pipeline).includes(`"${DONE}"`)) return { pipeline, changed: 0 };
  return { pipeline: { ...pipeline, steps: walk(pipeline.steps) }, changed };
}

/** Pure: the move/return pipeline. */
export function completedToDonePipeline({ tasksPageId, doneFieldId, sinceFieldId }) {
  let n = 0; const id = () => `cd-${++n}`;
  const act = (config) => ({ id: id(), type: "action", config });
  const iff = (operator, rules, then, els = []) => ({ id: id(), type: "if", condition: { operator, rules: rules.map((r) => ({ id: id(), ...r })) }, then, else: els });
  return { sources: [], steps: [
    act({ type: "INIT_VAR", name: "$tasksPage", value: tasksPageId }),
    act({ type: "FIND", predicate: { operator: "AND", rules: [{ id: id(), left: "id", comparator: "IS", right: "$trigger.occurrenceId" }] }, itemVar: "$item" }),
    act({ type: "INIT_VAR", name: "$task", expr: "$item" }),
    // Ticked on a copy (the Schedule's Todo shows copy-links of Tasks rows): act on the original under Tasks.
    iff("AND", [
      { left: "$item._ancestors", comparator: "NOT_HAS_ANCESTOR", right: "$tasksPage" },
      { left: "$item.linkedGroupId", comparator: "IS_NOT_EMPTY", right: "" },
    ], [act({ type: "FIND", over: "$allInstances", itemVar: "$task", predicate: { operator: "AND", rules: [
      { id: id(), left: "linkedGroupId", comparator: "IS", right: "$item.linkedGroupId" },
      { id: id(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$tasksPage" },
    ] } })]),
    iff("AND", [
      { left: "$task._ancestors", comparator: "HAS_ANCESTOR", right: "$tasksPage" },
      { left: `$task.fields.${COMPLETED}.value`, comparator: "IS", right: "true" },
      { left: "$task.parentId", comparator: "IS_NOT", right: DONE },
    ], [
      act({ type: "UPDATE", path: "$task.meta.doneFrom", value: "$task.parentId" }),
      act({ type: "MOVE_OCCURRENCE", occurrenceIdExpr: "$task.id", toContainerIdExpr: `literal:${DONE}` }),
    ]),
    iff("AND", [
      { left: "$task.parentId", comparator: "IS", right: DONE },
      { left: `$task.fields.${COMPLETED}.value`, comparator: "IS_NOT", right: "true" },
      { left: "$task.meta.doneFrom", comparator: "IS_NOT_EMPTY", right: "" },
    ], [
      act({ type: "MOVE_OCCURRENCE", occurrenceIdExpr: "$task.id", toContainerIdExpr: "$task.meta.doneFrom" }),
      act({ type: "UPDATE", path: "$task.meta.doneFrom", value: null }),
      ...(sinceFieldId ? [act({ type: "UPDATE", path: `$task.fields.${sinceFieldId}.value`, value: null })] : []),
      ...(doneFieldId ? [act({ type: "UPDATE", path: `$task.fields.${doneFieldId}.value`, value: false })] : []),
    ]),
  ] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Occurrence, Field, Grid } = models;
  const done = await Occurrence.findOne({ gridId, id: DONE }).lean();
  if (!done?.parentId) throw new Error("no Tasks › Done section");
  const grid = await Grid.findById(gridId).lean();
  const doneField = await Field.findOne({ gridId, name: "Done", type: "boolean" }).lean();
  const since = await Field.findOne({ gridId, name: "Done Since", type: "date" }).lean();
  const pdw = await Operation.findOne({ gridId, name: PDW }).lean();
  const rew = pdw ? acceptDoneFromTodo(pdw.pipeline) : { changed: 0 };
  const existing = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  const markDone = await Operation.findOne({ gridId, name: "Tasks: Mark Done" }).lean();
  log(`  ${OP_NAME}: ${existing ? "replace" : "create"} (Tasks page ${done.parentId})`);
  log(`  ${PDW}: ${rew.changed} Todo rules also accept a Done row from Todo`);
  if (dryRun) return;
  const doc = {
    name: OP_NAME, enabled: true, folderId: markDone?.folderId || null,
    description: "Ticking Completed moves a task under the Tasks page into Done (remembering where it was); unticking it there moves it back.",
    pipeline: completedToDonePipeline({ tasksPageId: done.parentId, doneFieldId: doneField?.id, sinceFieldId: since?.id }),
    triggerObjects: [{ eventType: "onChange", subjectType: "field", targetId: COMPLETED, priority: 4 }],
    triggerTypes: ["onChange"], triggerType: "onChange", updatedAt: new Date(),
  };
  if (existing) await Operation.updateOne({ gridId, id: existing.id }, { $set: doc });
  else await Operation.create({ id: randomUUID(), userId: String(grid.userId), gridId, ...doc });
  if (rew.changed) await Operation.updateOne({ gridId, id: pdw.id }, { $set: { pipeline: rew.pipeline, updatedAt: new Date() } });
  log("  applied. RESTART pm2.");
}
