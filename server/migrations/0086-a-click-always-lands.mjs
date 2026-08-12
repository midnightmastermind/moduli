// server/migrations/0086-a-click-always-lands.mjs
//
// User, 2026-08-12: "it should always be in sync between todays emotional wheel
// and todays schedule. same as the other days. if i click on a days emotional
// wheel, it shouldnt select it on tomorrows as well"
//
// MEASURED BEFORE CHANGING ANYTHING, and the measurement moved the whole
// problem. Firing the STORED op through the REAL executor once per day column
// showed the days are already ISOLATED — each writes to its own date, nothing
// leaks to tomorrow. What differs is whether the day has anything to write TO:
//
//   column        Mood recorded       Check In placed in the schedule
//   2026-08-06    NONE                none
//   2026-08-10    journal 3688118a    none      <- records, but not on the schedule
//   2026-08-11    NONE                none
//   2026-08-12    journal 1ff5e9c9    Todo 1a10b1cc
//
// So the click SILENTLY HALF-SUCCEEDS, differently on different days — which is
// exactly "not in sync, and not the same as the other days". Two causes, both
// data-shaped rather than wheel-shaped:
//
//   1. THE TODO IS TRANSIENT. `Schedule: Build Schedule` rebuilds day columns for
//      the FILTERED dates, so only the current day still has one; the older
//      columns are Day Page columns whose Schedule day-col is long gone. Of the
//      four Todo containers on the grid, exactly one is listed by a real column.
//      The Check In had nowhere to go, so the `IF $todo IS_NOT_EMPTY` guard
//      skipped it and the schedule showed nothing.
//   2. NOT EVERY DAY HAS A JOURNAL. Journals exist for 3 dates; on the others the
//      host FIND binds nothing and `IF $moodHost IS_NOT_EMPTY` swallows the whole
//      write — the 0046 failure, still live on any day without one.
//
// THE FIX IS THAT A CLICK ALWAYS LANDS SOMEWHERE. The Check In falls back to the
// DAY COLUMN ITSELF when that day has no Todo: the column is the thing you are
// looking at, it always exists (you clicked a wheel inside it), and it IS that
// day's view of the schedule. So the row appears on every day, on the day you
// clicked, and the wheel — which reads the Mood field per day — lights it.
//
// THAT ALSO MAKES THE CHECK IN SUFFICIENT ON ITS OWN. It carries the Date and the
// Mood, so a day with no journal still records, still lights, and still counts in
// the tracker. The journal write stays exactly as it was, best-effort inside its
// own guard: where a journal exists it is a real visible record and removing it
// would delete something the user can see.
//
// UN-PICKING FOLLOWS THE SAME PARENT. The stale-Check-In FIND is scoped to the
// same `$placeParent`, so a mood recorded on a column is found and removed from
// that column — scoping it to the Todo would have left every fallback-placed row
// undeletable, which is a worse failure than not placing it at all.
import { buildFieldReadPipeline } from "./0085-wheel-reads-the-field.mjs";
import { randomUUID as uuid } from "node:crypto";

export const id = "0086-a-click-always-lands";
export const describe =
  "A wheel click records and places on EVERY day — falling back to the day column when that day has no Todo.";

/**
 * PURE — 0085's pipeline with the Check In placement made unconditional.
 * Exported so a test drives exactly what ships.
 *
 * THROWS when the shape it means to change is missing.
 */
export function buildAlwaysLandsPipeline(args) {
  const pipeline = buildFieldReadPipeline(args);
  let reparented = 0;
  let ungated = 0;
  let rescoped = 0;

  // `$placeParent` — the Todo when the day has one, else the column itself.
  // Declared up front for the same reason 0083 declares its vars: referencing an
  // unbound var THROWS, and the pipeline dies inside the executor's try/catch
  // where the click just silently does nothing.
  const declarePlace = {
    id: uuid(), type: "action", actionType: "INIT_VAR",
    config: { name: "$placeParent", expr: "literal:" },
  };
  const resolvePlace = [
    {
      id: uuid(), type: "if",
      condition: { operator: "AND", rules: [
        { left: "$todo", comparator: "IS_NOT_EMPTY", right: null },
      ]},
      then: [{ id: uuid(), type: "action", actionType: "SET_VAR",
        config: { name: "$placeParent", expr: "$todo.id" } }],
      // THE FALLBACK IS THE COLUMN YOU CLICKED IN. Not the Schedule page (which
      // would put the row on no particular day) and not nothing (which is the
      // silent half-success this migration exists to end).
      else: [{ id: uuid(), type: "action", actionType: "SET_VAR",
        config: { name: "$placeParent", expr: "$col.id" } }],
    },
  ];

  let placed = false;
  const walk = (steps) => steps.flatMap((step) => {
    if (step?.type === "if") {
      // The `IF $todo IS_NOT_EMPTY` wrapper around the COPY_LINK is REMOVED —
      // its branch now always runs, against $placeParent.
      const rules = step.condition?.rules || [];
      const isTodoGate =
        rules.length === 1 &&
        rules[0]?.left === "$todo" &&
        rules[0]?.comparator === "IS_NOT_EMPTY" &&
        (step.then || []).some((s) => s.actionType === "COPY_LINK");
      if (isTodoGate) {
        ungated++;
        return walk(step.then || []);
      }
      return [{ ...step, then: walk(step.then || []), else: walk(step.else || []) }];
    }

    if (step?.actionType === "COPY_LINK" && step.config?.parent === "$todo.id") {
      reparented++;
      return [{ ...step, config: { ...step.config, parent: "$placeParent" } }];
    }

    // The place resolution must sit immediately AFTER the Todo FIND — which 0083
    // emits NESTED inside the toggle's parent branch, not at the top level. A
    // top-level splice silently found nothing; the fail-closed guard caught it.
    if (step?.actionType === "FIND" && step.config?.itemVar === "$todo") {
      placed = true;
      return [step, ...resolvePlace];
    }

    if (step?.actionType === "FIND") {
      const rules = step.config?.predicate?.rules || [];
      const hit = rules.some((r) => r?.comparator === "HAS_ANCESTOR" && r?.right === "$todo.id");
      if (hit) {
        rescoped++;
        return [{
          ...step,
          config: {
            ...step.config,
            predicate: {
              ...step.config.predicate,
              rules: rules.map((r) =>
                r?.comparator === "HAS_ANCESTOR" && r?.right === "$todo.id"
                  ? { ...r, right: "$placeParent" }
                  : r),
            },
          },
        }];
      }
    }
    return [step];
  });

  // The place resolution must sit AFTER the Todo FIND and BEFORE anything that
  // reads $placeParent. The FIND is emitted immediately before the toggle, so
  // splicing right after it is the one position that is correct by construction.
  const steps = [declarePlace, ...walk(pipeline.steps || [])];

  if (!placed || reparented !== 1 || ungated !== 1 || rescoped !== 1) {
    throw new Error(
      `0086: expected the Todo find + 1 reparent + 1 ungate + 1 rescope, got ` +
      `found=${placed} reparent=${reparented} ungate=${ungated} rescope=${rescoped}`
    );
  }
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));

  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const moodField = fields.find((f) => f.name === "Mood");
  const timeslotField = fields.find((f) => f.name === "Time Slot");
  const completedField = fields.find((f) => f.name === "Completed" && f.type === "boolean");
  const graphs = occs.filter((o) => modById.get(o.moduleId)?.kind === "graph");
  const schedulePage = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Schedule";
  });
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

  // REPORT WHICH DAYS ARE CURRENTLY BROKEN, so the run can be checked against the
  // measurement rather than taken on trust.
  const graph = graphs[0];
  const cols = occs.filter((o) => (o.occurrences || []).includes(graph.id));
  const descendants = (rootId) => {
    const seen = new Set();
    const stack = [...(byId.get(rootId)?.occurrences || [])];
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      for (const y of byId.get(x)?.occurrences || []) stack.push(y);
    }
    return seen;
  };
  log(`the wheel is rendered in ${cols.length} column(s):`);
  for (const col of cols) {
    const kids = descendants(col.id);
    const todo = [...kids].find((k) => byId.get(k)?.fields?.[timeslotField.id]?.value === "Todo");
    const day = col.fields?.[dateField.id]?.value;
    log(`  ${String(day).padEnd(12)} ${todo ? `Todo ${todo.slice(0, 8)}` : "no Todo -> will place on the COLUMN"}`);
  }

  const already = JSON.stringify(op.pipeline?.steps || []).includes("$placeParent");
  if (already) {
    log(`pipeline already falls back to the column — no change.`);
    if (dryRun) return;
  }

  if (dryRun) {
    log(`WOULD make the Check In placement unconditional: parent = the day's Todo when it ` +
      `has one, else the day COLUMN — so a click records and places on every day.`);
    return;
  }

  if (!already) {
    const pipeline = buildAlwaysLandsPipeline({
      graphOccId: graph.id,
      moodFieldId: moodField.id,
      dateFieldId: dateField.id,
      schedulePageOccId: schedulePage.id,
      checkInSourceOccId: checkInOccs[0].id,
      timeslotFieldId: timeslotField.id,
      completedFieldId: completedField.id,
    });
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  }
  log(`a click now records and places on every day.`);
}
