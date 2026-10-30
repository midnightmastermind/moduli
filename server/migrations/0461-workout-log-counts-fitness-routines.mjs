// 0461 — Workout Log lists every FITNESS routine of the day, not only rows with a Movement picked (user, 2026-10-30: "im
// not seeing the workouts in the list, the list just says -"). Friday's workouts are Run and Stretch: Run binds no
// Movement and Stretch's is empty, so Workout History (0460) found nothing. A workout is now a Schedule row with a
// Movement OR one placed from a routine in Routines › Physical › Fitness (Exercise, Stretch, Walk, Run, Recover — read
// from that container every run, so a routine added there later counts). A row with movements lists each movement as
// before; one without lists itself, by its own name.
export const id = "0461-workout-log-counts-fitness-routines";
export const describe = "Workout Log also lists Fitness routines (Run, Stretch, Walk…) that have no Movement.";
export const touches = ["operations"];

/** Workout History (as 0460 left it) counting Fitness routines too. PURE. */
export function withFitnessRoutines(pipeline, { fitnessContainerId, movementFieldId }) {
  const p = JSON.parse(JSON.stringify(pipeline));
  const loopIdx = p.steps.findIndex((s) => s.type === "loop" && s.overExpr === "$allInstances");
  const loop = p.steps[loopIdx];
  const gate = loop?.body?.find((s) => s.type === "if");
  if (!gate) throw new Error("Workout History: no instance gate");
  const mvPath = `$inst.fields.${movementFieldId}.value`;
  const ri = gate.condition.rules.findIndex((r) => r.left === mvPath && r.comparator === "IS_NOT_EMPTY");
  if (ri < 0) throw new Error("Workout History: no Movement rule");
  const mvRule = gate.condition.rules[ri];
  gate.condition.rules[ri] = { id: "wl0461or", operator: "OR", rules: [mvRule,
    { id: "wl0461fit", left: "$fitMods", comparator: "ARRAY_INCLUDES", right: "$inst.moduleId" }] };
  // the Fitness routines' modules, read from the container each run
  p.steps.splice(loopIdx, 0,
    { id: "wl0461init", type: "action", config: { type: "INIT_VAR", name: "$fitMods", value: [] } },
    { id: "wl0461loop", type: "loop", overExpr: "$allInstances", as: "$fi", body: [
      { id: "wl0461if", type: "if", condition: { operator: "AND", rules: [
        { id: "wl0461anc", left: "$fi._ancestors", comparator: "HAS_ANCESTOR", right: fitnessContainerId },
        { id: "wl0461feed", left: "$fi.meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
      ] }, then: [{ id: "wl0461push", type: "action", config: { type: "PUSH_TO_ARRAY", name: "$fitMods", value: "$fi.moduleId" } }], else: [] },
    ] });
  // a row with no movement lists itself
  const inner = gate.then.find((s) => s.type === "loop");
  const push = inner?.body?.find((s) => s.config?.type === "PUSH_TO_ARRAY");
  const lastIf = inner?.body?.find((s) => s.id === "wl0460lastIf");
  if (!push || !lastIf) throw new Error("Workout History: 0460 shape not found");
  const own = JSON.parse(JSON.stringify(push)); own.id = "wl0461own"; own.config.value = { ...own.config.value, label: "$inst.label" };
  const ownLast = JSON.parse(JSON.stringify(lastIf)); ownLast.id = "wl0461ownLast";
  ownLast.then = ownLast.then.map((s) => ({ ...s, id: s.id + "-own", config: { ...s.config, expr: "$inst.label" } }));
  const branch = { id: "wl0461hasMv", type: "if", condition: { operator: "AND", rules: [{ id: "wl0461mv", left: mvPath, comparator: "IS_NOT_EMPTY", right: "" }] },
    then: [inner], else: [own, ownLast] };
  gate.then.splice(gate.then.indexOf(inner), 1, branch);
  return p;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Module, Occurrence } = models;
  const op = await Operation.findOne({ gridId, name: "Workout History" }).lean();
  if (!op) throw new Error("no Workout History op");
  if (JSON.stringify(op.pipeline).includes("wl0461or")) { log("  already done"); return; }
  if (!JSON.stringify(op.pipeline).includes("wl0460status0")) throw new Error("run 0460 first");
  const mv = await Field.findOne({ gridId, name: "Movement" }).lean();
  const fitMod = await Module.find({ gridId, role: "container", label: "Fitness" }).select("id").lean();
  const routines = await Occurrence.findOne({ gridId, id: "n1KSK9wrbjuX" }).lean();
  const occs = await Occurrence.find({ gridId, moduleId: { $in: fitMod.map((x) => x.id) } }).select("id parentId occurrences").lean();
  // the Fitness container under Routines › Physical (it lists the routines)
  const physical = await Occurrence.find({ gridId, id: { $in: routines?.occurrences || [] } }).select("id occurrences").lean();
  const fit = occs.find((o) => physical.some((p) => (p.occurrences || []).includes(o.id)) && (o.occurrences || []).length);
  if (!mv || !fit) throw new Error("Movement field or Routines › Physical › Fitness not found");
  const next = withFitnessRoutines(op.pipeline, { fitnessContainerId: fit.id, movementFieldId: mv.id });
  log(`  Fitness container ${fit.id} (${(fit.occurrences || []).length} routines)`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: next, updatedAt: new Date() } });
  log("  applied. RESTART pm2.");
}
