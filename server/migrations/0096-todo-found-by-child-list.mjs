// server/migrations/0096-todo-found-by-child-list.mjs
//
// User, 2026-08-13: "it also didnt add the checkins to the schedule. it added
// them underneath the graph on the daypage."
//
// THAT IS 0086'S FALLBACK FIRING WHEN IT SHOULD NOT, and the cause is the
// last-writer-wins ancestor walk for the FIFTH time. 0083 finds the day's Todo
// with `_ancestors HAS_ANCESTOR $col.id`. Measured against today's data:
//
//   column 2026-08-13 (a5bc3869)
//     Todo in its OWN child list : 66086919
//     Todo the ancestor FIND sees: NONE  -> falls back to the column
//
//   66086919 chain = [Schedule - Thursday, Augus < Schedule < Panel C]
//
// The Todo is multi-parented into the Schedule day-col AND the Day Page column,
// `buildParentMap` keys a child to ONE parent, and it picked the Schedule side —
// so the chain never reaches the Day Page column the user clicked in, the FIND
// binds nothing, and the Check In lands on the column itself. Which is exactly
// what "underneath the graph on the daypage" looks like.
//
// SO THE LOOKUP STOPS WALKING ANCESTORS. The column's own `occurrences[]` is an
// EXPLICIT list — no derived parent map, no last writer, nothing to lose — and
// the Todo is in it. Looping that list is multi-parent-safe by construction,
// which an ancestor test can never be while a child may have two parents.
//
// The 0086 fallback STAYS for the day that genuinely has no Todo (three of the
// five columns still have none). It is a floor, not the normal path.
export const id = "0096-todo-found-by-child-list";
export const describe =
  "The day's Todo is found in the column's own child list, so Check Ins land on the schedule.";

/**
 * PURE — replace the ancestor-scoped Todo FIND with a scan of $col.occurrences.
 * Exported so a test drives exactly what ships.
 */
export function buildChildListLookup(pipeline, { timeslotFieldId }) {
  if (!timeslotFieldId) throw new Error("0096: missing timeslotFieldId");
  let replaced = 0;

  const scan = () => ([
    {
      id: `todoscan-${Math.random().toString(36).slice(2, 10)}`,
      type: "loop", overExpr: "$col.occurrences", as: "$todoKidId",
      body: [
        { id: `tk-${Math.random().toString(36).slice(2, 10)}`,
          type: "action", actionType: "INIT_VAR",
          config: { name: "$todoKid", expr: "$allItemsById.${$todoKidId}" } },
        { id: `ti-${Math.random().toString(36).slice(2, 10)}`,
          type: "if",
          condition: { operator: "AND", rules: [
            { left: `$todoKid.fields.${timeslotFieldId}.value`, comparator: "IS", right: "Todo" },
          ]},
          then: [{ id: `ts-${Math.random().toString(36).slice(2, 10)}`,
            type: "action", actionType: "SET_VAR",
            config: { name: "$todo", expr: "$todoKid" } }],
          else: [] },
      ],
    },
  ]);

  const walk = (steps) => (steps || []).flatMap((step) => {
    if (step?.type === "if") {
      return [{ ...step, then: walk(step.then), else: walk(step.else) }];
    }
    if (step?.type === "loop") {
      return [{ ...step, body: walk(step.body), ...(step.config?.body
        ? { config: { ...step.config, body: walk(step.config.body) } } : {}) }];
    }
    if (step?.actionType === "FIND" && step.config?.itemVar === "$todo") {
      replaced++;
      return scan();
    }
    return [step];
  });

  const steps = walk(pipeline?.steps || []);
  if (replaced !== 1) {
    throw new Error(`0096: expected exactly 1 Todo find to replace, found ${replaced}`);
  }
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Occurrence, Module } = models;
  const fields = await Field.find({ gridId }).lean();
  const timeslot = fields.find((f) => f.name === "Time Slot");
  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const op = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();
  if (!timeslot || !dateField || !op) {
    log(`REFUSING: timeslot=${!!timeslot} date=${!!dateField} op=${!!op} — nothing written.`);
    return;
  }

  // REPORT WHICH DAYS THIS ACTUALLY CHANGES, against the child list the new
  // lookup will read — so the run can be checked rather than trusted.
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const graph = occs.find((o) => modById.get(o.moduleId)?.kind === "graph");
  const cols = graph ? occs.filter((o) => (o.occurrences || []).includes(graph.id)) : [];
  for (const col of cols.sort((a, b) =>
    String(a.fields?.[dateField.id]?.value).localeCompare(String(b.fields?.[dateField.id]?.value)))) {
    const todo = (col.occurrences || []).map((i) => byId.get(i))
      .find((k) => k?.fields?.[timeslot.id]?.value === "Todo");
    log(`  ${String(col.fields?.[dateField.id]?.value).padEnd(12)} ` +
      `${todo ? `Todo ${todo.id.slice(0, 8)} -> lands on the SCHEDULE` : "no Todo -> still the column (0086 floor)"}`);
  }

  const already = JSON.stringify(op.pipeline?.steps || []).includes("$todoKidId");
  if (already) { log(`the lookup already reads the child list — no change.`); if (dryRun) return; }
  if (dryRun) {
    log(`WOULD replace the ancestor-scoped Todo FIND with a scan of $col.occurrences.`);
    return;
  }
  if (!already) {
    const pipeline = buildChildListLookup(op.pipeline, { timeslotFieldId: timeslot.id });
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  }
  log(`the day's Todo is found in the column's own child list.`);
}
