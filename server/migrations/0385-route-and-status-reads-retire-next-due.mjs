// server/migrations/0385-route-and-status-reads-retire-next-due.mjs
//
// The user's answers, 2026-10-03:
//
// 1. "Schedule: Route by Timeslot" and "Project: Status Router" never fired for
//    an edit made by hand: both gate on `$trigger.fields.<id>.value`, which is
//    undefined for a UI edit (the trigger carries the RAW value — `$trigger.value`
//    is the reliable read). Route's slot FIND also matched the slot of that name
//    in EVERY day column. Route gets the shape built and watched on the rebuild
//    grid (2026-10-02 (8)): the item's own day column, then the slot inside it.
//    Status Router and its sibling "Project: Sync To Todo List" (same trigger,
//    same read) read `$trigger.value`.
// 2. "Compute Next Due" and "Due: Seed" are deleted — "Bills: Into Schedule"
//    (0384) replaced them and they had not written a Next Due since August. The
//    fields only they used (Next Due, Every N Days, Anchor Date) and Cadence go
//    too. "Monthly Bills" summed bills whose Cadence IS monthly; a bill is now
//    monthly by having a Day (user: "its suppose to be a 1-30 thing"), so it
//    sums bills with a Day, and both bill tiles re-run on a Day edit instead of
//    a Cadence edit.
//
// Every field is deleted only when nothing on the grid still names it.

export const id = "0385-route-and-status-reads-retire-next-due";
export const describe = "Route by Timeslot finds the item's own day column; Status Router / Sync To Todo List read $trigger.value; deletes Compute Next Due + Due: Seed and the Next Due / Cadence / Every N Days / Anchor Date fields.";
export const touches = ["operations", "fields"];

const r = (left, comparator, right) => ({ left, comparator, right });
const and = (...rules) => ({ operator: "AND", rules });
const act = (id, config) => ({ id, type: "action", config });

/** PURE. Route by Timeslot, the rebuild's shape. */
export function buildRoutePipeline({ schedPageId, formatFieldId, dateFieldId, timeslotFieldId }) {
  return {
    sources: [],
    steps: [
      { id: "rt-has", type: "if", condition: and(r("$trigger.value", "IS_NOT_EMPTY", "")), then: [
        act("rt-item", { type: "INIT_VAR", name: "$item", expr: "$trigger.occurrence" }),
        act("rt-col0", { type: "INIT_VAR", name: "$dayColId", expr: "literal:" }),
        act("rt-col", { type: "FIND", over: "$allContainers", itemIdVar: "$dayColId", predicate: and(
          r("_ancestors", "HAS_ANCESTOR", schedPageId),
          r(`fields.${formatFieldId}.value`, "IS", "day-col"),
          r(`fields.${dateFieldId}.value`, "SAME_DAY", `$item.fields.${dateFieldId}.value`),
        ) }),
        { id: "rt-hascol", type: "if", condition: and(r("$dayColId", "IS_NOT_EMPTY", "")), then: [
          act("rt-slot0", { type: "INIT_VAR", name: "$targetSlotId", expr: "literal:" }),
          act("rt-slot", { type: "FIND", over: "$allContainers", itemIdVar: "$targetSlotId", predicate: and(
            r("_ancestors", "HAS_ANCESTOR", "$dayColId"),
            r(`fields.${formatFieldId}.value`, "IS", "slot"),
            r(`fields.${timeslotFieldId}.value`, "IS", "$trigger.value"),
          ) }),
          { id: "rt-hasslot", type: "if", condition: and(r("$targetSlotId", "IS_NOT_EMPTY", "")), then: [
            act("rt-move", { type: "MOVE_OCCURRENCE", occurrenceIdExpr: "$trigger.occurrenceId", toContainerIdExpr: "$targetSlotId" }),
          ] },
        ] },
      ] },
    ],
  };
}

/** PURE. Every `$trigger.fields.<fieldId>.value` becomes `$trigger.value`. */
export function readTriggerValue(pipeline, fieldId) {
  const from = `$trigger.fields.${fieldId}.value`;
  return JSON.parse(JSON.stringify(pipeline).split(from).join("$trigger.value"));
}

/** PURE. Monthly = has a Day; Cadence triggers become Day triggers. */
export function monthlyByDay(op, { cadenceFieldId, dayFieldId }) {
  const walk = (steps) => (steps || []).map((s) => {
    const n = { ...s };
    if (s.condition?.rules) n.condition = { ...s.condition, rules: s.condition.rules.map((rule) =>
      rule.left === `$item.fields.${cadenceFieldId}.value` && rule.comparator === "IS" && rule.right === "monthly"
        ? { ...rule, left: `$item.fields.${dayFieldId}.value`, comparator: "IS_NOT_EMPTY", right: "" } : rule) };
    for (const k of ["then", "else", "body"]) if (s[k]) n[k] = walk(s[k]);
    return n;
  });
  return {
    pipeline: { ...op.pipeline, steps: walk(op.pipeline?.steps) },
    triggerObjects: (op.triggerObjects || []).map((t) => (t.targetId === cadenceFieldId ? { ...t, targetId: dayFieldId } : t)),
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Grid, Occurrence, Module } = models;
  const grid = await Grid.findById(gridId).lean();
  const sf = grid?.meta?.scheduleFieldIds || {};
  const fields = await Field.find({ gridId }).lean();
  const one = (name, type) => { const h = fields.filter((f) => f.name === name && (!type || f.type === type)); return h.length === 1 ? h[0].id : null; };
  const ids = { schedPageId: sf.pageOccurrenceId, formatFieldId: sf.scheduleFormatFieldId, dateFieldId: sf.dateFieldId, timeslotFieldId: sf.timeslotFieldId,
    statusFieldId: one("Status"), dayFieldId: one("Day", "number"), cadenceFieldId: one("Cadence") };
  const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`0385: cannot resolve ${missing.join(", ")}`);
  const op = async (name) => { const o = await Operation.findOne({ gridId, name }).lean(); if (!o) throw new Error(`0385: no operation "${name}"`); return o; };

  const route = await op("Schedule: Route by Timeslot");
  const router = await op("Project: Status Router");
  const sync = await op("Project: Sync To Todo List");
  const monthly = await op("Monthly Bills");
  const paid = await op("Bills: Paid This Month");
  const retire = await Operation.find({ gridId, name: { $in: ["Compute Next Due", "Due: Seed"] } }).lean();

  const writes = [
    [route, { pipeline: buildRoutePipeline(ids) }],
    [router, { pipeline: readTriggerValue(router.pipeline, ids.statusFieldId) }],
    [sync, { pipeline: readTriggerValue(sync.pipeline, ids.statusFieldId) }],
    [monthly, monthlyByDay(monthly, ids)],
    [paid, monthlyByDay(paid, ids)],
  ];
  for (const [o, set] of writes) log(`update "${o.name}"`);
  log(`delete operations: ${retire.map((o) => o.name).join(", ") || "none"}`);

  // Fields to retire — only when, after the writes above, nothing on the grid names them.
  const retireNames = ["Next Due", "Cadence", "Every N Days", "Anchor Date"];
  const retireIds = retireNames.map((n) => one(n)).filter(Boolean);
  const afterOps = (await Operation.find({ gridId }).lean())
    .filter((o) => !retire.some((x) => x.id === o.id))
    .map((o) => { const w = writes.find(([x]) => x.id === o.id); return JSON.stringify({ ...o, ...(w ? w[1] : {}) }); });
  const otherDocs = [
    ...(await Module.find({ gridId }).lean()).map((m) => JSON.stringify(m)),
    ...(await Occurrence.find({ gridId }).lean()).map((o) => JSON.stringify({ fields: o.fields, filters: o.filters, filterOverride: o.filterOverride, fieldVisibility: o.fieldVisibility, meta: o.meta, feed: o.feed })),
    JSON.stringify(grid.meta || {}), JSON.stringify(grid.activeFilterValues || {}), JSON.stringify(grid.namedFilters || grid.filters || {}),
  ];
  const stillNamed = retireIds.filter((fid) => afterOps.some((s) => s.includes(fid)) || otherDocs.some((s) => s.includes(fid)));
  if (stillNamed.length) throw new Error(`0385: still referenced, refusing: ${stillNamed.map((fid) => fields.find((f) => f.id === fid).name).join(", ")}`);
  log(`delete fields: ${retireIds.map((fid) => fields.find((f) => f.id === fid).name).join(", ")}`);
  if (dryRun) return;

  for (const [o, set] of writes) await Operation.updateOne({ gridId, id: o.id }, { $set: set });
  if (retire.length) await Operation.deleteMany({ gridId, id: { $in: retire.map((o) => o.id) } });
  if (retireIds.length) await Field.deleteMany({ gridId, id: { $in: retireIds } });
  log("done. Restart the server (pm2).");
}
