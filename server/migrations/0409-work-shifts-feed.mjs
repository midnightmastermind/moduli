// 0409 — the work-shifts calendar feed files into Tasks › Work Shifts, typed Employment.
//
// User, 2026-10-16: *"i also added a new ics feed for work events. could you edit the feed to go to a
// new work shifts container inside the tasks page and then map it to my calendar via the operations
// like we do holidays"*. Holidays (2026-10-13 (3)): the feed names a destination ("file events
// into"), and the "Share: calendar (.ics)" rule types an event Holiday when it is filed into the
// Holidays board. The same, here:
//   1. a "Work Shifts" board container on the Tasks page (after Mr Brews Taphouse)
//   2. the Sling feed (calendar.getsling.com) files into it
//   3. the rule's $stype becomes Employment when the destination is Work Shifts — so the shift is a
//      dated, timed Schedule Type row and "Schedule: Place Dated Work" puts it on the Schedule
//   4. the shifts it already filed into Appointments (typed Appointment) move into Work Shifts and
//      become Employment.
// Idempotent: finds the container by label on the Tasks page; the rule branch by its target id.

import { randomUUID } from "node:crypto";

export const id = "0409-work-shifts-feed";
export const describe = "Work-shifts feed (Sling) files into a new Tasks › Work Shifts container; the calendar share rule types those events Employment; the 4 shifts already filed in Appointments move there.";
export const touches = ["modules", "occurrences", "operations"];   // + one grid.feeds[].destinationId (was none), not in the snapshot set

const SLING = /calendar\.getsling\.com/;

/** PURE. The rule's steps with an Employment branch after the Holiday one (once). */
export function withEmploymentBranch(steps, { workShiftsOccId, employmentOccId }) {
  if (JSON.stringify(steps).includes(workShiftsOccId)) return null;            // already there
  const i = steps.findIndex((s) => s.type === "if" && (s.then || []).some((t) => t.config?.type === "SET_VAR" && t.config?.name === "$stype"));
  if (i < 0) throw new Error("0409: the rule's Holiday branch ($stype) was not found");
  const branch = {
    id: randomUUID().slice(0, 7), type: "if",
    condition: { operator: "AND", rules: [{ id: randomUUID().slice(0, 7), left: "$share.props.destinationId", comparator: "IS", right: workShiftsOccId }] },
    then: [{ id: randomUUID().slice(0, 7), type: "action", config: { type: "SET_VAR", name: "$stype", expr: `literal:${employmentOccId}` } }],
    else: [],
  };
  return [...steps.slice(0, i + 1), branch, ...steps.slice(i + 1)];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Module, Occurrence, Operation, Field } = models;
  const gid = String(gridId);
  const grid = await Grid.findById(gid).lean();
  const userId = String(grid.userId);

  // the Tasks page that holds the task containers (the other "Tasks" page is empty)
  const tasksMods = await Module.find({ gridId: gid, role: "page", label: "Tasks" }, { id: 1 }).lean();
  const tasksOccs = await Occurrence.find({ gridId: gid, moduleId: { $in: tasksMods.map((m) => m.id) } }).lean();
  const tasks = tasksOccs.sort((a, b) => (b.occurrences?.length || 0) - (a.occurrences?.length || 0))[0];
  if (!tasks?.occurrences?.length) throw new Error("0409: Tasks page not found");
  const kids = await Occurrence.find({ gridId: gid, id: { $in: tasks.occurrences } }, { id: 1, moduleId: 1 }).lean();
  const kmods = new Map((await Module.find({ gridId: gid, id: { $in: kids.map((k) => k.moduleId) } }, { id: 1, label: 1 }).lean()).map((m) => [m.id, m.label]));
  const labelOf = (id) => kmods.get(kids.find((k) => k.id === id)?.moduleId);
  const appts = tasks.occurrences.find((id) => labelOf(id) === "Appointments");
  const after = tasks.occurrences.find((id) => labelOf(id) === "Mr Brews Taphouse") || appts;
  let workId = tasks.occurrences.find((id) => labelOf(id) === "Work Shifts");

  const feed = (grid.feeds || []).find((f) => SLING.test(f.url || ""));
  if (!feed) throw new Error("0409: the Sling feed was not found");
  const typesPage = await Module.findOne({ gridId: gid, role: "page", label: "Schedule Types" }, { id: 1 }).lean();
  const typesOcc = typesPage && await Occurrence.findOne({ gridId: gid, moduleId: typesPage.id }).lean();
  const typesBoard = typesOcc?.occurrences?.[0];
  const empMods = await Module.find({ gridId: gid, role: "instance", label: "Employment" }, { id: 1 }).lean();
  const emp = await Occurrence.findOne({ gridId: gid, moduleId: { $in: empMods.map((m) => m.id) }, parentId: typesBoard }).lean();
  if (!emp) throw new Error("0409: no Employment row on the Schedule Types board");
  const stField = await Field.findOne({ gridId: gid, name: "Schedule Type" }, { id: 1 }).lean();
  const rule = await Operation.findOne({ gridId: gid, name: "Share: calendar (.ics)" }).lean();
  if (!rule) throw new Error("0409: no calendar share rule");

  // shifts the feed already filed elsewhere
  const filed = Object.values(feed.items || {}).flatMap((x) => x.ids || []);
  const shifts = await Occurrence.find({ gridId: gid, id: { $in: filed } }, { id: 1, parentId: 1, fields: 1 }).lean();
  const toMove = shifts.filter((s) => s.parentId !== workId);

  log(`Tasks page ${tasks.id}: Work Shifts ${workId ? "exists" : "to create"} after ${labelOf(after)}`);
  log(`feed "${feed.name}": destination ${feed.destinationId || "none"} → Work Shifts; Employment = ${emp.id}`);
  log(`shifts already filed: ${shifts.length}, to move into Work Shifts: ${toMove.length}`);
  if (dryRun) return;

  if (!workId) {
    const modId = randomUUID(); workId = randomUUID();
    await Module.create({ id: modId, userId, gridId: gid, role: "container", kind: "board", label: "Work Shifts", fieldBindings: [], meta: {} });
    await Occurrence.create({ id: workId, userId, gridId: gid, moduleId: modId, targetId: modId, targetType: "module", parentId: tasks.id, occurrences: [], fields: {}, meta: {} });
    const list = [...tasks.occurrences]; list.splice(list.indexOf(after) + 1, 0, workId);
    await Occurrence.updateOne({ gridId: gid, id: tasks.id }, { $set: { occurrences: list } });
  }
  await Grid.updateOne({ _id: grid._id, "feeds.id": feed.id }, { $set: { "feeds.$.destinationId": workId } });
  const steps = withEmploymentBranch(rule.pipeline.steps, { workShiftsOccId: workId, employmentOccId: emp.id });
  if (steps) await Operation.updateOne({ _id: rule._id }, { $set: { "pipeline.steps": steps } });
  for (const s of toMove) {
    if (s.parentId) await Occurrence.updateOne({ gridId: gid, id: s.parentId }, { $pull: { occurrences: s.id } });
    await Occurrence.updateOne({ gridId: gid, id: workId }, { $addToSet: { occurrences: s.id } });
    const $set = { parentId: workId };
    if (stField) $set[`fields.${stField.id}`] = { ...(s.fields?.[stField.id] || {}), value: emp.id };
    await Occurrence.updateOne({ gridId: gid, id: s.id }, { $set });
  }
  const back = await Occurrence.findOne({ gridId: gid, id: workId }).lean();
  log(`Work Shifts lists ${back.occurrences.length}; rule branch ${steps ? "added" : "already there"}. Restart the server (pm2).`);
}
