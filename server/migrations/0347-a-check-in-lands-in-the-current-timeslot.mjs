// 0347 — a picked mood's Check In is also listed in the Schedule's CURRENT
// timeslot.
//
// User, 2026-09-19: *"currently no checkin is being created in the schedule
// though when i select a mood"* — asked where: *"Current timeslot"*.
//
// ONE occurrence in two places, the way Schedule slots already multi-list: the
// Check In stays PARENTED to the day column (it renders under the Emotions
// Wheel) and is additionally LISTED by the slot. So deleting it from either
// place deletes it — and deselects the mood — everywhere.
//
// WHICH SLOT: on the Schedule's day column for the day the wheel was clicked
// on, the latest slot whose time is at or before now (`$currentTime`, 24h
// "HH:MM"; slot labels are "7:30am" — the time comparators parse both). The
// slots are walked through that day column's OWN `occurrences[]`, never by
// `_ancestors`: `buildParentMap` keys a child to ONE parent (last writer wins),
// and a list is the placement itself. Measured before writing: all 49 of
// today's slots are owned by today's column and none is shared with another day.
//
// No Schedule column for that day (the Schedule only builds the dates in view)
// or no slot at or before now → the Check In stays on the day page only.
//
// Field ids come from `grid.meta.scheduleFieldIds`, the source the alarm op
// already uses — never matched by name.

export const id = "0347-a-check-in-lands-in-the-current-timeslot";
export const describe = "Mood: Record Selection also lists each new Check In in the Schedule's current timeslot for that day. Pipeline only.";
export const touches = ["operations"];

const MOOD_OP = "Mood: Record Selection";
const MARK = "checkInIntoCurrentSlot";
const AFTER = "embedNewCheckIn";   // 0343's step — this goes right after it

export function slotSteps({ schedulePageId, formatFieldId, dateFieldId, timeslotFieldId }) {
  const ts = (v) => `${v}.fields.${timeslotFieldId}.value`;
  return [{
    id: MARK, type: "if",
    condition: { operator: "AND", rules: [{ id: `${MARK}-new`, left: "$newCheckIn", comparator: "IS_NOT_EMPTY", right: null }] },
    then: [
      { id: `${MARK}-i1`, type: "action", actionType: "INIT_VAR", config: { type: "INIT_VAR", name: "$schedDayCol", expr: "literal:" } },
      { id: `${MARK}-i2`, type: "action", actionType: "INIT_VAR", config: { type: "INIT_VAR", name: "$nowSlot", expr: "literal:" } },
      { id: `${MARK}-find`, type: "action", actionType: "FIND", config: { type: "FIND", over: "$allContainers", itemVar: "$schedDayCol",
        predicate: { operator: "AND", rules: [
          { id: `${MARK}-r1`, left: "_ancestors", comparator: "HAS_ANCESTOR", right: schedulePageId },
          { id: `${MARK}-r2`, left: `fields.${formatFieldId}.value`, comparator: "IS", right: "day-col" },
          { id: `${MARK}-r3`, left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$day" },
        ] } } },
      { id: `${MARK}-has`, type: "if",
        condition: { operator: "AND", rules: [{ id: `${MARK}-h`, left: "$schedDayCol", comparator: "IS_NOT_EMPTY", right: null }] },
        then: [
          { id: `${MARK}-loop`, type: "loop", overExpr: "$schedDayCol.occurrences", as: "$slotId", body: [
            { id: `${MARK}-slot`, type: "action", actionType: "INIT_VAR", config: { type: "INIT_VAR", name: "$slot", expr: "$allItemsById.${$slotId}" } },
            { id: `${MARK}-isslot`, type: "if",
              condition: { operator: "AND", rules: [
                { id: `${MARK}-s1`, left: `$slot.fields.${formatFieldId}.value`, comparator: "IS", right: "slot" },
                { id: `${MARK}-s2`, left: ts("$slot"), comparator: "IS_NOT_EMPTY", right: null },
              ] },
              then: [{ id: `${MARK}-future`, type: "if",
                // A slot LATER than now is skipped; everything else is a candidate.
                condition: { operator: "AND", rules: [{ id: `${MARK}-f`, left: ts("$slot"), comparator: "TIME_AFTER", right: "$currentTime" }] },
                then: [],
                else: [{ id: `${MARK}-first`, type: "if",
                  condition: { operator: "AND", rules: [{ id: `${MARK}-e`, left: "$nowSlot", comparator: "IS_EMPTY", right: null }] },
                  then: [{ id: `${MARK}-set1`, type: "action", actionType: "SET_VAR", config: { type: "SET_VAR", name: "$nowSlot", expr: "$slot" } }],
                  else: [{ id: `${MARK}-later`, type: "if",
                    condition: { operator: "AND", rules: [{ id: `${MARK}-l`, left: ts("$slot"), comparator: "TIME_AFTER", right: ts("$nowSlot") }] },
                    then: [{ id: `${MARK}-set2`, type: "action", actionType: "SET_VAR", config: { type: "SET_VAR", name: "$nowSlot", expr: "$slot" } }],
                    else: [] }] }] }],
              else: [] },
          ] },
          { id: `${MARK}-place`, type: "if",
            condition: { operator: "AND", rules: [{ id: `${MARK}-p`, left: "$nowSlot", comparator: "IS_NOT_EMPTY", right: null }] },
            then: [{ id: `${MARK}-add`, type: "action", actionType: "ADD_CHILD",
              config: { type: "ADD_CHILD", parentId: "$nowSlot.id", childId: "$newCheckIn" } }],
            else: [] },
        ],
        else: [] },
    ],
    else: [],
  }];
}

/** PURE — insert right after 0343's embed step. Throws unless exactly one. Idempotent. */
export function placeInCurrentSlot(pipeline, ids) {
  if (JSON.stringify(pipeline || {}).includes(`"${MARK}"`)) return { pipeline, changed: 0 };
  let anchors = 0;
  const walk = (steps) => (steps || []).flatMap((s) => {
    if (s?.id === AFTER) { anchors++; return [s, ...slotSteps(ids)]; }
    if (s?.type === "if") return [{ ...s, then: walk(s.then), else: walk(s.else) }];
    if (s?.type === "loop") return [{ ...s, body: walk(s.body) }];
    return [s];
  });
  const steps = walk(pipeline?.steps || []);
  if (anchors !== 1) throw new Error(`0347: expected exactly 1 ${AFTER} step, found ${anchors}`);
  return { pipeline: { ...pipeline, steps }, changed: 1 };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Operation, Grid } = models;
  const gid = String(gridId);
  const grid = await Grid.findById(gid).lean();
  const sf = grid?.meta?.scheduleFieldIds || {};
  const ids = { schedulePageId: sf.pageOccurrenceId, formatFieldId: sf.scheduleFormatFieldId,
    dateFieldId: sf.dateFieldId, timeslotFieldId: sf.timeslotFieldId };
  const op = await Operation.findOne({ gridId: gid, name: MOOD_OP }).lean();
  if (!op || Object.values(ids).some((v) => !v)) {
    log(`  REFUSING: op=${!!op} scheduleFieldIds=${JSON.stringify(ids)} — nothing written.`);
    return { changed: 0 };
  }
  const plan = placeInCurrentSlot(op.pipeline, ids);
  log(`  ${MOOD_OP}: ${plan.changed ? "lists each new Check In in the current timeslot" : "already does"}`);
  if (dryRun) { log("  Dry run — nothing written."); return { changed: 0 }; }
  if (!plan.changed) return { changed: 0 };
  await Operation.updateOne({ gridId: gid, id: op.id }, { $set: { pipeline: plan.pipeline } });
  const after = await Operation.findOne({ gridId: gid, id: op.id }).lean();
  if (placeInCurrentSlot(after.pipeline, ids).changed) throw new Error("0347: the op did not take the edit");
  return { changed: 1 };
}
