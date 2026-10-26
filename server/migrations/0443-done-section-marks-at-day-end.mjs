// 0443 — the Tasks page's Done section marks its rows done at the end of the day and then hides them (user,
// 2026-10-26: "an operation that runs once a day at the end of the day, to mark the tasks in the done section with a
// done = true and then have the filter hide those. we only mark them at the end of the day so if i drag some in
// there, they stay until they are marked").
//
// A clock-time job runs only if a tab is open at that minute (the scheduler is in the page), so a strict 11:59pm job
// would be missed most nights. Instead "Tasks: Mark Done" runs on load, when a row is added or moved into Done, and
// every 15 minutes: a row first seen in Done gets Done Since = today; a row whose Done Since is an earlier day gets
// Done = true. So whatever is dragged in stays visible all day and is marked at the first run after midnight.
// The Done section gets a local filter Done IS false (its nav switch shows the marked ones again).
import { randomUUID } from "node:crypto";

export const id = "0443-done-section-marks-at-day-end";
export const describe = "Fields Done (boolean) and Done Since (date); a 'Done IS false' filter on the Tasks page's Done section; op 'Tasks: Mark Done' (on load, on add/move into Done, every 15 min) stamps Done Since on rows new to Done and sets Done = true on rows there since an earlier day.";
export const touches = ["fields", "occurrences", "operations"];

const DONE_SECTION = "eac2cc53-c04f-403e-ac01-dd0d76bb8f19";

/** The op's pipeline. Pure. */
export function markDonePipeline({ sectionId, doneId, sinceId }) {
  const s = (n) => `md-${n}`;
  return { sources: [], steps: [
    { id: s("sec"), type: "action", config: { type: "INIT_VAR", name: "$doneSection", expr: `$allItemsById.${sectionId}` } },
    { id: s("loop"), type: "loop", overExpr: "$doneSection.occurrences", as: "$rowId", body: [
      { id: s("row"), type: "action", config: { type: "INIT_VAR", name: "$row", expr: "$allItemsById.${$rowId}" } },
      { id: s("open"), type: "if", condition: { operator: "AND", rules: [
        { id: s("r1"), left: "$row.id", comparator: "IS_NOT_EMPTY", right: null },
        { id: s("r2"), left: `$row.fields.${doneId}.value`, comparator: "IS_NOT", right: "true" },
      ] }, then: [
        { id: s("new"), type: "if", condition: { operator: "AND", rules: [{ id: s("r3"), left: `$row.fields.${sinceId}.value`, comparator: "IS_EMPTY", right: null }] },
          then: [{ id: s("stamp"), type: "action", config: { type: "UPDATE", path: `$row.fields.${sinceId}.value`, value: "$today" } }],
          else: [{ id: s("old"), type: "if", condition: { operator: "AND", rules: [{ id: s("r4"), left: `$row.fields.${sinceId}.value`, comparator: "DATE_BEFORE", right: "$today" }] },
            then: [{ id: s("mark"), type: "action", config: { type: "UPDATE", path: `$row.fields.${doneId}.value`, value: "json:true" } }], else: [] }] },
      ], else: [] },
    ] },
  ] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Occurrence, Operation, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const section = await Occurrence.findOne({ gridId, id: DONE_SECTION }).lean();
  if (!section) throw new Error("no Done section on this grid");
  if (await Operation.exists({ gridId, name: "Tasks: Mark Done" })) { log("  already there"); return; }
  for (const n of ["Done", "Done Since"]) if (await Field.exists({ gridId, name: n })) throw new Error(`a field named ${n} already exists`);
  const completed = await Field.findOne({ gridId, name: "Completed" }).lean();
  const stampOp = await Operation.findOne({ gridId, name: "Schedule: Stamp Completed On" }).lean();
  log(`  fields Done + Done Since (category of Completed) · filter "Done IS false" on Done (${(section.occurrences || []).length} rows, all stay visible until the first run after midnight) · op Tasks: Mark Done`);
  if (dryRun) return;

  const doneId = randomUUID(), sinceId = randomUUID();
  await Field.create({ id: doneId, userId, gridId, name: "Done", type: "boolean", folderId: completed?.folderId || null, meta: { note: "Set by Tasks: Mark Done on rows in the Tasks page's Done section since an earlier day." } });
  await Field.create({ id: sinceId, userId, gridId, name: "Done Since", type: "date", folderId: completed?.folderId || null, meta: { note: "The day a row was first seen in the Tasks page's Done section." } });
  await Occurrence.updateOne({ gridId, id: DONE_SECTION }, {
    $push: { filters: { id: randomUUID(), fieldId: doneId, active: true, showNav: true, comparator: "IS", hides: false } },
    $set: { [`filterOverride.${doneId}`]: false, updatedAt: new Date() },
  });
  await Operation.create({
    id: randomUUID(), userId, gridId, name: "Tasks: Mark Done", folderId: stampOp?.folderId || null, enabled: true,
    description: "Rows in the Tasks page's Done section: Done Since = the day first seen there; Done = true once that day has passed.",
    pipeline: markDonePipeline({ sectionId: DONE_SECTION, doneId, sinceId }),
    triggerObjects: [
      { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 7 },
      { eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", ancestorId: DONE_SECTION, priority: 7 },
      { eventType: "onMove", subjectType: "module", subjectRole: "instance", targetId: "", ancestorId: DONE_SECTION, priority: 7 },
    ],
    triggerTypes: ["onLoad", "onAdd", "onMove"], triggerType: "onLoad",
    schedule: { kind: "interval", every: 15, unit: "minute", suppressNotifications: true, lastFiredAt: null },
  });
  log("  applied. RESTART pm2.");
}
