// 0506 — a work shift shows in its start slot again, and carries its Hours (user, 2026-11-17: "my mr brews work
// occurances are being put into a later timeslot. i work 9am-3pm today and it only lists it in 930 onward" · "put a
// text field in there called hours and list like 9am-3pm in it with an operation. check the operation for these
// imports").
//
// Measured: the shift (Tasks › Work Shifts, Time Slot 9:00am, Duration 6h, from the calendar share — the import is
// right) had its 9:00am copy made at 00:01 into a version of today's schedule that was then rebuilt. That copy still
// exists, listed by nothing; the 9:30–2:30 copies hang off it (Duration Copies). "Place Dated Work" only copies a
// shift into its start slot while its Scheduled box is unticked (0484 — so a copy you DELETE does not come back), and
// it was ticked by the first placement. So the start slot stayed empty.
//
// (1) Place Dated Work: when today's start slot has no copy, a copy of this row for this day that is NOT under the
//     Schedule (orphaned by a rebuild) is moved into the slot. A deleted copy is gone, so 0484's rule still holds.
// (2) Hours: a text field, bound on the shifts' modules (so their Schedule copies show it too) and attached by the
//     calendar import; "Work Shifts: Hours" writes Time Slot + Duration as "9am-3pm" (TIME_RANGE) on every shift.
export const id = "0506-shift-start-slot-and-hours";
export const describe = "Place Dated Work re-homes a shift copy orphaned by a schedule rebuild into its start slot; a Hours field (\"9am-3pm\") filled by the operation \"Work Shifts: Hours\" and attached by the calendar import.";
export const touches = ["fields", "modules", "operations"];

const PDW = "Schedule: Place Dated Work";
const SHARE_ICS = "Share: calendar (.ics)";
const HOURS_OP = "Work Shifts: Hours";
const WORK_SHIFTS = "ea0ffa77-3947-4158-91a5-cc5bba96ab51";
const F = { date: "Eh7oi4HKdbHB", slot: "nSccAtADyUGW", duration: "1wNjBBeOTwA2" };
const uid = () => Math.random().toString(36).slice(2, 14);
const rule = (left, comparator, right) => ({ id: uid(), left, comparator, right });

/** The re-home steps, placed right after the FIND that looks for today's copy in the slot. Pure. */
export function rehomeSteps() {
  return [
    { id: "rehome-find", type: "action", config: { type: "FIND", over: "$allInstances", first: true, itemIdVar: "$orphanCopyId",
      predicate: { operator: "AND", rules: [
        rule("meta.copyLinkSource", "IS", "$appt.id"),
        rule("meta.datedWork", "IS", true),
        rule(`fields.${F.date}.value`, "SAME_DAY", "$day"),
        rule("_ancestors", "NOT_HAS_ANCESTOR", "$schedPageId"),
      ] } } },
    { id: "rehome-if", type: "if", condition: { operator: "AND", rules: [rule("$apptCopyId", "IS_EMPTY", ""), rule("$orphanCopyId", "IS_NOT_EMPTY", "")] },
      then: [
        { id: uid(), type: "action", config: { type: "LINK_OCCURRENCE_TO_PARENT", parentId: "$slotId", childId: "$orphanCopyId" } },
        { id: uid(), type: "action", config: { type: "SET_VAR", name: "$apptCopyId", expr: "$orphanCopyId" } },
      ], else: [] },
  ];
}

/** Place Dated Work with the re-home steps after the `$apptCopyId` FIND. Pure; [pipeline, inserted]. Idempotent. */
export function withRehome(pipeline) {
  if (JSON.stringify(pipeline || {}).includes('"rehome-find"')) return [pipeline, 0];
  let inserted = 0;
  const walk = (steps) => {
    const out = [];
    for (const st of steps || []) {
      const s = { ...st };
      for (const k of ["then", "else", "body"]) if (Array.isArray(st[k])) s[k] = walk(st[k]);
      out.push(s);
      if (st?.type === "action" && st.config?.type === "FIND" && st.config.itemIdVar === "$apptCopyId") { out.push(...rehomeSteps()); inserted++; }
    }
    return out;
  };
  const next = { ...pipeline, steps: walk(pipeline?.steps) };
  return [next, inserted];
}

/** The Hours operation's pipeline. Pure. */
export function hoursPipeline(hoursId) {
  return { sources: [], steps: [
    { id: uid(), type: "loop", overExpr: "$allInstances", as: "$s", body: [
      { id: uid(), type: "if", condition: { operator: "AND", rules: [
        rule("$s._ancestors", "HAS_ANCESTOR", WORK_SHIFTS),
        rule(`$s.fields.${F.slot}.value`, "IS_NOT_EMPTY", ""),
        rule("$s.meta.feedSourceId", "IS_EMPTY", ""),
      ] }, then: [
        { id: uid(), type: "action", config: { type: "TIME_RANGE", start: `$s.fields.${F.slot}.value`, minutes: `$s.fields.${F.duration}.value`, to: "$hrs" } },
        { id: uid(), type: "if", condition: { operator: "AND", rules: [rule("$hrs", "IS_NOT_EMPTY", ""), rule(`$s.fields.${hoursId}.value`, "IS_NOT", "$hrs")] },
          then: [{ id: uid(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: hoursId, occurrenceIdExpr: "$s.id", valueExpr: "$hrs" } }], else: [] },
      ], else: [] },
    ] },
  ] };
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation } = models;
  const pdw = await Operation.findOne({ gridId, name: PDW }).lean();
  if (!pdw) throw new Error(`REFUSING: no "${PDW}"`);
  const [pdwPipe, inserted] = withRehome(pdw.pipeline);
  log(`  ${PDW}: re-home steps inserted at ${inserted} place(s)`);
  if (inserted > 1) throw new Error("REFUSING: more than one $apptCopyId FIND");

  const ws = await Occurrence.findOne({ gridId, id: WORK_SHIFTS }).lean();
  if (!ws) throw new Error("REFUSING: no Work Shifts");
  const shiftRows = await Occurrence.find({ gridId, id: { $in: ws.occurrences || [] } }).select("id moduleId").lean();
  const moduleIds = [...new Set(shiftRows.map((o) => o.moduleId))];
  let hours = await Field.findOne({ gridId, name: "Hours" }).lean();
  log(`  Hours field: ${hours ? `exists (${hours.type})` : "create (text)"} · bind on ${moduleIds.length} shift module(s)`);
  if (hours && hours.type !== "text") throw new Error(`REFUSING: a field named Hours exists with type ${hours.type}`);
  const share = await Operation.findOne({ gridId, name: SHARE_ICS }).lean();
  const existingOp = await Operation.findOne({ gridId, name: HOURS_OP }).lean();
  log(`  "${SHARE_ICS}": ${share ? "attach Hours" : "not found"} · "${HOURS_OP}": ${existingOp ? "exists — left alone" : "create"}`);
  if (dryRun) return;

  if (inserted) await Operation.updateOne({ gridId, id: pdw.id }, { $set: { pipeline: pdwPipe, updatedAt: new Date() } });
  if (!hours) {
    hours = { id: uid(), userId: pdw.userId, gridId, name: "Hours", type: "text", inputEnabled: true, displayEnabled: false,
      meta: { placeholder: "9am-3pm" }, siblingLinks: [], displayConfig: {}, createdAt: new Date(), updatedAt: new Date() };
    await Field.collection.insertOne(hours);
  }
  for (const mid of moduleIds) {
    const m = await Module.findOne({ gridId, id: mid }).lean();
    if (!m || (m.fieldBindings || []).some((b) => b.fieldId === hours.id)) continue;
    const order = Math.max(-1, ...(m.fieldBindings || []).map((b) => b.order ?? 0)) + 1;
    await Module.updateOne({ gridId, id: mid }, { $push: { fieldBindings: { fieldId: hours.id, role: "input", order } } });
  }
  if (share) {
    const pipe = JSON.parse(JSON.stringify(share.pipeline));
    const walk = (steps) => { for (const st of steps || []) { if (st?.config?.type === "CREATE" && Array.isArray(st.config.attachFields) && !st.config.attachFields.includes(hours.id)) st.config.attachFields.push(hours.id); for (const k of ["then", "else", "body"]) walk(st[k]); } };
    walk(pipe.steps);
    await Operation.updateOne({ gridId, id: share.id }, { $set: { pipeline: pipe, updatedAt: new Date() } });
  }
  if (!existingOp) {
    await Operation.collection.insertOne({
      id: uid(), userId: pdw.userId, gridId, name: HOURS_OP, enabled: true, priority: 5,
      description: "Writes a shift's Time Slot + Duration into Hours as \"9am-3pm\" (0506).",
      triggerType: "onLoad", folderId: pdw.folderId ?? null,
      triggerObjects: [
        { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 5 },
        { eventType: "onChange", subjectType: "field", targetId: F.slot, priority: 5 },
        { eventType: "onChange", subjectType: "field", targetId: F.duration, priority: 5 },
        { eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", priority: 5, ancestorId: WORK_SHIFTS },
      ],
      triggerTypes: ["onLoad", "onChange", "onAdd"],
      pipeline: hoursPipeline(hours.id), createdAt: new Date(), updatedAt: new Date(),
    });
  }
  const back = await Operation.findOne({ gridId, id: pdw.id }).lean();
  const bound = await Module.countDocuments({ gridId, id: { $in: moduleIds }, "fieldBindings.fieldId": hours.id });
  log(`  read back: re-home ${JSON.stringify(back.pipeline).includes('"rehome-find"')} · Hours bound on ${bound}/${moduleIds.length} · op ${!!(await Operation.findOne({ gridId, name: HOURS_OP }).lean())}`);
  if (!JSON.stringify(back.pipeline).includes('"rehome-find"') || bound !== moduleIds.length) throw new Error("read-back failed");
  log("  applied. RESTART pm2.");
}
