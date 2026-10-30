// 0460 — Workout Log shows today's movements ONCE (user, 2026-10-30: "workout logs, but arent we using two diff things
// inside of there too? we have workouts and workouts1...6" → "Merge into one list"). The Workouts table (Workout
// History) listed only FINISHED movements with their sets; Workout 1–6 (Fitness: Today's Prescription) listed every
// planned movement as "— done / not yet". Now Workout History lists every movement of the tile's period with a Status
// ("done" once completed, "not yet" before), its sets/weights beside it; Last Workout = the last finished one. The
// prescription op and the six Workout N fields go. Stepping the date back still shows that day's list.
export const id = "0460-workout-log-one-list";
export const describe = "Merges Workout 1–6 into Workout Log's Workouts table (a Status column); drops Fitness: Today's Prescription.";
export const touches = ["operations", "fields", "modules", "occurrences"];

const HISTORY = "Workout History";
const PRESCRIPTION = "Fitness: Today's Prescription";
const TILE_MODULE = "bna6hkrwra";

/** Workout History's pipeline with unfinished movements included and a status per row. PURE. */
export function mergedHistoryPipeline(pipeline, completedFieldId) {
  const p = JSON.parse(JSON.stringify(pipeline));
  const loop = p.steps.find((s) => s.type === "loop" && s.overExpr === "$allInstances");
  const gate = loop?.body?.find((s) => s.type === "if");
  if (!gate) throw new Error("Workout History: no instance gate");
  const isCompletedGroup = (r) => r.operator === "OR" && (r.rules || []).some((x) => String(x.left).includes(`<${completedFieldId}>`) || String(x.left).includes(`fields.${completedFieldId}.value`));
  const before = gate.condition.rules.length;
  gate.condition.rules = gate.condition.rules.filter((r) => !isCompletedGroup(r));
  if (gate.condition.rules.length !== before - 1) throw new Error("Workout History: the Completed rule was not found exactly once");
  const inner = gate.then.find((s) => s.type === "loop");
  if (!inner) throw new Error("Workout History: no movement loop");
  const status = [
    { id: "wl0460status0", type: "action", config: { type: "SET_VAR", name: "$status", value: "not yet" } },
    { id: "wl0460statusIf", type: "if", condition: { operator: "OR", rules: [
      { id: "wl0460c1", left: `$inst.fields.${completedFieldId}.value`, comparator: "IS", right: true },
      { id: "wl0460c2", left: "$inst._boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: completedFieldId },
    ] }, then: [{ id: "wl0460statusDone", type: "action", config: { type: "SET_VAR", name: "$status", value: "done" } }], else: [] },
  ];
  gate.then.splice(gate.then.indexOf(inner), 0, ...status);
  const push = inner.body.find((s) => s.config?.type === "PUSH_TO_ARRAY");
  if (!push) throw new Error("Workout History: no row push");
  push.config.value = { label: push.config.value.label, status: "$status", ...push.config.value };
  const lastIdx = inner.body.findIndex((s) => s.config?.type === "SET_VAR" && s.config.name === "$lastW");
  if (lastIdx < 0) throw new Error("Workout History: no Last Workout step");
  const last = inner.body[lastIdx];
  inner.body[lastIdx] = { id: "wl0460lastIf", type: "if", condition: { operator: "AND", rules: [{ id: "wl0460c3", left: "$status", comparator: "IS", right: "done" }] }, then: [last], else: [] };
  return p;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Module, Occurrence } = models;
  const ops = await Operation.find({ gridId }).lean();
  const hist = ops.find((o) => o.name === HISTORY);
  const pres = ops.find((o) => o.name === PRESCRIPTION);
  if (!hist) throw new Error("no Workout History op");
  if (JSON.stringify(hist.pipeline).includes("wl0460status0")) { log("  already merged"); return; }
  const completed = await Field.findOne({ gridId, name: "Completed", type: "boolean" }).lean();
  // the stored pipeline names fields by id; the gate's Completed rule reads fields.<id>.value
  const compId = completed?.id;
  if (!compId || !JSON.stringify(hist.pipeline).includes(compId)) throw new Error("Workout History does not read Completed");
  const next = mergedHistoryPipeline(hist.pipeline, compId);
  const workoutsField = await Field.findOne({ gridId, name: "Workouts" }).lean();
  const cols = workoutsField?.displayConfig?.columns || [];
  const nextCols = cols.some((c) => c.path === "status") ? cols : [cols[0], { path: "status", header: "Status" }, ...cols.slice(1)];
  const slots = await Field.find({ gridId, name: { $in: ["Workout 1", "Workout 2", "Workout 3", "Workout 4", "Workout 5", "Workout 6"] } }).lean();
  for (const f of slots) {
    const elsewhere = ops.filter((o) => o.id !== pres?.id && JSON.stringify([o.pipeline, o.triggers]).includes(f.id));
    const bound = await Module.countDocuments({ gridId, id: { $ne: TILE_MODULE }, "fieldBindings.fieldId": f.id });
    if (elsewhere.length || bound) throw new Error(`${f.name} is used elsewhere`);
  }
  log(`  Workout History: unfinished movements included, Status column · drop ${pres ? PRESCRIPTION : "(no prescription op)"} · drop ${slots.map((f) => f.name).join(", ")}`);
  if (dryRun) return;
  const now = new Date();
  await Operation.updateOne({ gridId, id: hist.id }, { $set: { pipeline: next, updatedAt: now } });
  if (workoutsField) await Field.updateOne({ gridId, id: workoutsField.id }, { $set: { "displayConfig.columns": nextCols, updatedAt: now } });
  if (pres) await Operation.deleteOne({ gridId, id: pres.id });
  const ids = slots.map((f) => f.id);
  await Module.updateOne({ gridId, id: TILE_MODULE }, { $pull: { fieldBindings: { fieldId: { $in: ids } } }, $set: { updatedAt: now } });
  const unset = Object.fromEntries(ids.map((id) => [`fields.${id}`, ""]));
  if (ids.length) await Occurrence.updateMany({ gridId, $or: ids.map((id) => ({ [`fields.${id}`]: { $exists: true } })) }, { $unset: unset });
  await Field.deleteMany({ gridId, id: { $in: ids } });
  log("  applied. RESTART pm2.");
}
