// server/migrations/0098-moods-persist.mjs
//
// User, 2026-08-13: "the entire point is recording everything. the moods need to
// persist. if i go back to yesterday, it should show the moods for that day."
//
// THIS IS DATA LOSS AND I SHIPPED IT. 0086/0096 put the Check In inside the day's
// Todo — which is part of the SCHEDULE, and `Schedule: Build Schedule` rebuilds
// day columns for the FILTERED dates. When it rebuilds, the old day-col and its
// Todo are deleted, and `delete_occurrence` cascades into every child whose
// `parentId` points at the deleted node. The Check In was such a child, so the
// mood went with it. Measured: 10 Check In rows existed on the 12th; after the
// schedule rebuilt for the 13th, one survived.
//
// THE FIX IS THE SPLIT THIS REPO ALREADY USES FOR UPLOADS: `parentId` is the
// row's HOME, the parent's `occurrences[]` entry is its PLACEMENT (2026-08-07
// (7)). And the cascade is the reason it works — `collectDescendants` only
// recurses through a child when `child.parentId === id`, so a row homed
// elsewhere is UNLINKED by a parent's deletion, never deleted with it.
//
//   parentId  -> the DAY COLUMN   (durable: 08-06 .. 08-13 all still exist)
//   listed by -> the day's Todo   (the schedule placement the user asked for)
//
// So the row shows up in the schedule while that schedule exists, stays on the
// day page for ever, and the wheel — which reads Mood values by DATE, not by
// location — lights that day whenever you go back to it.
//
// UN-PICKING STOPS WALKING ANCESTORS. With two parents, `_ancestors` resolves
// through whichever one buildParentMap kept (the trap 0089 and 0096 both hit),
// so scoping the stale-row lookup that way would leave rows undeletable at
// random. Mood + day is precise on its own: it is the same feeling on the same
// date, which is exactly what un-picking means.
export const id = "0098-moods-persist";
export const describe =
  "A recorded mood is HOMED on the day column and PLACED in the schedule, so a schedule rebuild cannot delete it.";

/** PURE — re-home the Check In and place it. Exported so a test drives what ships. */
export function buildPersistentPipeline(pipeline, { timeslotFieldId }) {
  let rehomed = 0, placed = 0, unscoped = 0;

  const walk = (steps) => (steps || []).flatMap((step) => {
    if (step?.type === "if") {
      return [{ ...step, then: walk(step.then), else: walk(step.else) }];
    }
    if (step?.type === "loop") {
      return [{ ...step, body: walk(step.body),
        ...(step.config?.body ? { config: { ...step.config, body: walk(step.config.body) } } : {}) }];
    }

    if (step?.actionType === "COPY_LINK") {
      rehomed++;
      placed++;
      const idVar = "$newCheckIn";
      return [
        // HOME: the day column. Survives the schedule being rebuilt.
        { ...step, config: { ...step.config, parent: "$col.id", itemIdVar: idVar } },
        // PLACEMENT: the schedule's Todo, when the day has one. ADD_CHILD
        // appends to occurrences[] WITHOUT touching parentId — that is the
        // multi-parent primitive, and it is what keeps the home durable.
        { id: `place-${Math.random().toString(36).slice(2, 10)}`,
          type: "if",
          condition: { operator: "AND", rules: [
            { left: "$todo", comparator: "IS_NOT_EMPTY", right: null },
          ]},
          then: [{ id: `addc-${Math.random().toString(36).slice(2, 10)}`,
            type: "action", actionType: "ADD_CHILD",
            config: { parentId: "$todo.id", childId: idVar } }],
          else: [] },
      ];
    }

    if (step?.actionType === "FIND" && step.config?.itemVar === "$staleCheckIn") {
      const rules = (step.config.predicate?.rules || [])
        .filter((r) => {
          const drop = r?.comparator === "HAS_ANCESTOR";
          if (drop) unscoped++;
          return !drop;
        });
      return [{ ...step, config: { ...step.config,
        predicate: { ...step.config.predicate, rules } } }];
    }
    return [step];
  });

  const steps = walk(pipeline?.steps || []);
  if (rehomed !== 1 || placed !== 1 || unscoped !== 1) {
    throw new Error(`0098: expected 1 copy-link + 1 placement + 1 ancestor rule, got ` +
      `rehome=${rehomed} place=${placed} unscope=${unscoped}`);
  }
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Occurrence, Module } = models;
  const fields = await Field.find({ gridId }).lean();
  const timeslot = fields.find((f) => f.name === "Time Slot");
  const moodField = fields.find((f) => f.name === "Mood");
  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const op = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();
  if (!timeslot || !moodField || !dateField || !op) {
    log(`REFUSING: timeslot=${!!timeslot} mood=${!!moodField} date=${!!dateField} op=${!!op}`);
    return;
  }

  // RE-HOME WHAT ALREADY EXISTS, or today's surviving rows stay at risk.
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const graph = occs.find((o) => modById.get(o.moduleId)?.kind === "graph");
  const cols = graph ? occs.filter((o) => (o.occurrences || []).includes(graph.id)) : [];
  const colForDay = (d) => cols.find((c) =>
    String(c.fields?.[dateField.id]?.value || "").slice(0, 10) === d);

  const rows = occs.filter((o) => {
    const v = o.fields?.[moodField.id]?.value;
    return Array.isArray(v) && v.length && modById.get(o.moduleId)?.role === "instance";
  });
  const moves = [];
  for (const r of rows) {
    const day = String(r.fields?.[dateField.id]?.value || "").slice(0, 10);
    const col = colForDay(day);
    if (!col) { log(`  ${r.id.slice(0, 8)} (${day}) has no day column — LEFT ALONE`); continue; }
    if (r.parentId === col.id) continue;
    const homeName = r.parentId
      ? (byId.get(r.parentId)?.label ?? modById.get(byId.get(r.parentId)?.moduleId)?.label ?? r.parentId.slice(0, 8))
      : "(none)";
    moves.push({ row: r, col, day, homeName });
  }
  log(`recorded moods: ${rows.length} · to re-home onto their day column: ${moves.length}`);
  for (const m of moves) log(`  ${m.row.id.slice(0, 8)} ${m.day}  home ${m.homeName} -> ${
    (m.col.label ?? modById.get(m.col.moduleId)?.label ?? "").slice(0, 24)}`);

  const already = JSON.stringify(op.pipeline?.steps || []).includes("$newCheckIn");
  log(`pipeline: ${already ? "already homes on the column" : "will home on the column and place in the Todo"}`);

  if (dryRun) {
    log(`WOULD re-home ${moves.length} existing mood row(s) and rewrite the op so a ` +
      `schedule rebuild can never delete one again.`);
    return;
  }

  for (const m of moves) {
    await Occurrence.updateOne({ gridId, id: m.row.id }, { $set: { parentId: m.col.id } });
    // Keep it listed by its durable home too, or re-homing hides it from the day.
    await Occurrence.updateOne(
      { gridId, id: m.col.id, occurrences: { $ne: m.row.id } },
      { $push: { occurrences: m.row.id } });
  }
  if (!already) {
    const pipeline = buildPersistentPipeline(op.pipeline, { timeslotFieldId: timeslot.id });
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  }
  log(`moods now persist: homed on the day column, placed in the schedule.`);
}
