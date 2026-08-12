// server/migrations/0083-mood-mints-a-check-in.mjs
//
// User, 2026-08-12: "no checkin occurance is showing up in todo after the click
// either like we talked about" / "thats what controls the mood tracker" /
// "if i deselect, it removes that mood from the schedule."
//
// WHY THE TRACKER HAS NEVER MOVED, measured rather than guessed. `Mood: Record
// Selection` writes the mood onto the JOURNAL, which is a role:"container". The
// `Moods` tracker loops `$allInstances`. A container can never satisfy that, so
// the op has been writing to a host the tracker is structurally unable to see.
//
// The tracker's real rules, dumped from the live op:
//     fields.Mood        IS_NOT_EMPTY
//     AND (fields.Date   DATE_IN_PERIOD $goalPeriod  OR  $goalPeriod IS_EMPTY)
//     AND _ancestors     HAS_ANCESTOR   <Schedule page>
//     AND meta.feedSourceId IS_EMPTY
//     AND (fields.Completed IS true  OR  the module does NOT bind Completed)
//
// So the thing it counts is an INSTANCE carrying a Mood and a Date, living under
// the Schedule. `Check In` is exactly that instance (role:"instance", binds
// Completed / Mood / Date / Category / Habit) and already exists in Routines —
// it simply never gets placed.
//
// WHERE IT GOES, and this was verified rather than assumed: today's Todo is
// listed by TWO parents — the Schedule day column AND the Day Page column the
// wheel resolves. So a Check In placed in the Todo the clicked column points at
// DOES satisfy HAS_ANCESTOR <Schedule>. A single-parent ancestor walk reports
// the opposite (Day Page < Panel D, no Schedule); that is the documented
// last-writer-wins trap in buildParentMap, and it is why this file finds the
// Todo by walking from the column rather than trusting one parent chain.
//
// COPY_LINK WITH `linked: false` IS THE PRIMITIVE, and it already exists for
// precisely this ("a fresh independent placement (e.g. per-day routine
// instance)" — operationActions.js). The alternatives are both wrong here:
// plain COPY_LINK shares a linkedGroupId, so ticking one Check In would tick
// every other AND write back to the Routines catalog entry; COPY_OCCURRENCE
// clones the MODULE too, which would mint five new modules a day.
//
// COMPLETED IS STAMPED TRUE, and that is a decision worth stating. The tracker
// ignores a Check In whose Completed is false, and the user asked for the mood
// to show up in the tracker ON SELECT. "I felt this" is an observation that has
// already happened, not a chore to tick later. The Schedule's Todo is a plain
// container — nothing sweeps ticked rows out of it — so the row still shows.
import { buildTogglePipeline } from "./0082-mood-click-toggles.mjs";
import { randomUUID as uuid } from "node:crypto";

export const id = "0083-mood-mints-a-check-in";
export const describe =
  "Picking a feeling also drops a Check In into that day's Todo (and un-picking removes it), " +
  "which is what the Moods tracker actually counts.";

/**
 * PURE — 0082's toggle with the Check In placement folded into both branches.
 * Exported so a test drives exactly what ships.
 *
 * THROWS when the toggle it means to extend is missing. A migration that
 * silently no-ops leaves a pipeline that looks updated and is not.
 */
export function buildCheckInPipeline(args) {
  const {
    checkInSourceOccId, timeslotFieldId, moodFieldId, dateFieldId, completedFieldId,
  } = args;
  for (const [k, v] of Object.entries({
    checkInSourceOccId, timeslotFieldId, moodFieldId, dateFieldId, completedFieldId,
  })) {
    if (!v) throw new Error(`0083: missing ${k}`);
  }

  const pipeline = buildTogglePipeline(args);
  let extended = 0;

  // DECLARE BEFORE USE. A FIND that matches nothing does not bind its itemVar,
  // and referencing an unbound var THROWS — the pipeline dies inside the
  // executor's try/catch and the click silently does nothing. That is why 0079
  // declares $graph/$col/$day/$moodHost with `literal:` up front, and it is
  // exactly what the first version of this migration got wrong: with no Todo
  // declared, `IF $todo IS_NOT_EMPTY` threw and NO Check In was ever created.
  const declare = ["$todo", "$staleCheckIn"].map((name) => ({
    id: uuid(), type: "action", actionType: "INIT_VAR",
    config: { name, expr: "literal:" },
  }));

  // The Todo bucket for the day that was CLICKED. Scoped by `_ancestors
  // HAS_ANCESTOR $col` rather than by date, because Todo carries no date of its
  // own — the column does. Identified by its Time Slot marker, which is what
  // `Schedule: Build Schedule` matches on, not by the label (a label is the
  // user's to rename).
  const findTodo = {
    id: uuid(), type: "action", actionType: "FIND",
    config: {
      over: "$allContainers", itemVar: "$todo",
      predicate: { conjunction: "AND", rules: [
        { left: `fields.${timeslotFieldId}.value`, comparator: "IS", right: "Todo" },
        // `$col.id`, not `$col`: the column is bound by a FIND, so `$col` is the
        // whole OCCURRENCE OBJECT and HAS_ANCESTOR compares ids. Passing the
        // object matches nothing and the Todo silently never binds.
        { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$col.id" },
      ]},
    },
  };

  // UN-PICKING: find the Check In that carries this feeling on this day and
  // delete it, so the tracker cannot drift from the wheel. Scoped to $todo, so
  // it can never reach a Check In the user placed somewhere else themselves.
  const removeCheckIn = [
    { id: uuid(), type: "action", actionType: "FIND",
      config: {
        over: "$allInstances", itemVar: "$staleCheckIn",
        predicate: { conjunction: "AND", rules: [
          { left: `fields.${moodFieldId}.value`, comparator: "ARRAY_INCLUDES", right: "$picked" },
          { left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$day" },
          { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$todo.id" },
        ]},
      } },
    { id: uuid(), type: "if",
      condition: { operator: "AND", rules: [
        { left: "$staleCheckIn", comparator: "IS_NOT_EMPTY", right: null },
      ]},
      then: [{ id: uuid(), type: "action", actionType: "DELETE",
        config: { itemIdExpr: "$staleCheckIn.id" } }],
      else: [] },
  ];

  // PICKING: one Check In per click (user's call over one-per-day accumulating).
  // Mood is stored as an ARRAY of one because that is the shape the field holds
  // everywhere else — cfg.fields resolves each value ONCE and has no way to
  // express a literal list around a variable, hence the two var steps.
  const addCheckIn = [
    { id: uuid(), type: "action", actionType: "INIT_VAR",
      config: { name: "$pickedList", value: [] } },
    { id: uuid(), type: "action", actionType: "MERGE_ARRAY",
      config: { name: "$pickedList", with: "$picked", unique: true } },
    { id: uuid(), type: "if",
      condition: { operator: "AND", rules: [
        { left: "$todo", comparator: "IS_NOT_EMPTY", right: null },
      ]},
      then: [{
        id: uuid(), type: "action", actionType: "COPY_LINK",
        config: {
          sourceId: checkInSourceOccId,
          parent: "$todo.id",
          // NO linkedGroupId: a fresh independent placement. Sharing one would
          // make ticking today's Check In tick every other one ever made, and
          // write back to the Routines catalog entry it was copied from.
          linked: false,
          // The catalog entry carries Category ["emotional"] and nothing else
          // worth inheriting; every field this row needs is stamped below.
          copyFields: false,
          recursive: false,
          fields: {
            [dateFieldId]: "$day",
            [moodFieldId]: "$pickedList",
            // See the header: the tracker skips a Check In that is not ticked.
            [completedFieldId]: "literal:true",
          },
        },
      }],
      else: [] },
  ];

  // The Todo lookup must sit IMMEDIATELY BEFORE the toggle, inside the same
  // branch — it reads $col, which an earlier FIND binds. The first version
  // inserted it before the first step MENTIONING "$moods", which is the
  // `INIT_VAR $moods` at the very top: it ran before $col existed, bound null,
  // and every Check In was silently skipped. Emitting it here, where the toggle
  // is actually identified, makes the ordering impossible to get wrong.
  const walk = (steps) => steps.flatMap((step) => {
    if (step?.type !== "if") return [step];
    const isToggle = (step.condition?.rules || []).some(
      (r) => r?.left === "$moods" && r?.comparator === "ARRAY_INCLUDES");
    if (isToggle) {
      extended++;
      return [findTodo, {
        ...step,
        then: [...(step.then || []), ...removeCheckIn],
        else: [...(step.else || []), ...addCheckIn],
      }];
    }
    return [{ ...step, then: walk(step.then || []), else: walk(step.else || []) }];
  });

  const steps = [...declare, ...walk(pipeline.steps || [])];
  if (extended !== 1) {
    throw new Error(`0083: expected exactly 1 mood toggle to extend, found ${extended}`);
  }

  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));

  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const moodField = fields.find((f) => f.name === "Mood");
  const timeslotField = fields.find((f) => f.name === "Time Slot");
  const completedField = fields.find((f) => f.name === "Completed" && f.type === "boolean");
  const graphs = occs.filter((o) => modById.get(o.moduleId)?.kind === "graph");
  const schedulePage = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Schedule";
  });
  // The Check In CATALOG entry — the one in Routines, i.e. the occurrence whose
  // module binds Mood and which is NOT itself under the Schedule.
  const checkInMods = mods.filter((m) => /^check ?in$/i.test(m.label || "") && m.role === "instance");
  const checkInOccs = occs.filter((o) => checkInMods.some((m) => m.id === o.moduleId));
  const op = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();

  if (!dateField || !moodField || !timeslotField || !completedField ||
      graphs.length !== 1 || !schedulePage || checkInOccs.length !== 1 || !op) {
    log(`REFUSING: Date=${!!dateField} Mood=${!!moodField} TimeSlot=${!!timeslotField} ` +
      `Completed=${!!completedField} graphs=${graphs.length} schedule=${!!schedulePage} ` +
      `checkIn=${checkInOccs.length} op=${!!op} — nothing written.`);
    return;
  }

  const already = JSON.stringify(op.pipeline?.steps || []).includes("$staleCheckIn");
  if (already) { log(`pipeline already mints a Check In — no change.`); return; }

  const pipeline = buildCheckInPipeline({
    graphOccId: graphs[0].id,
    moodFieldId: moodField.id,
    dateFieldId: dateField.id,
    schedulePageOccId: schedulePage.id,
    checkInSourceOccId: checkInOccs[0].id,
    timeslotFieldId: timeslotField.id,
    completedFieldId: completedField.id,
  });

  log(`Check In source ${checkInOccs[0].id.slice(0, 8)} · Todo found by Time Slot ` +
    `${timeslotField.id.slice(0, 8)} scoped to the clicked column`);
  if (dryRun) {
    log(`WOULD rewrite "Mood: Record Selection": picking a feeling drops a ticked Check In ` +
      `into that day's Todo carrying the Date and the Mood; un-picking deletes it.`);
    return;
  }
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  log(`rewrote "Mood: Record Selection" — a pick now places a Check In the Moods tracker counts.`);
}
