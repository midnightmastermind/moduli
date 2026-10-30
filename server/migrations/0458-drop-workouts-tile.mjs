// 0458 — the Trackers' "Workouts" tile and its tracker go (user, 2026-10-30, keeping "Workout Log": both tiles showed
// today's movements — Workout Log as "Planks — not yet", Workouts as "Planks: 0/1"). Removes the op "Workouts: Today's
// Session" (165 steps), the tile (its one placement, unlisted from Today's Workout, and its module) and the 26
// per-movement fields only that tile bound and only that op wrote. Refuses if any of them is used anywhere else.
export const id = "0458-drop-workouts-tile";
export const describe = "Deletes the Workouts tracker tile, its op and its 26 per-movement fields (Workout Log stays).";
export const touches = ["operations", "occurrences", "modules", "fields"];

const TILE_MODULE = "37aeud84n7g";
const OP_NAME = "Workouts: Today's Session";
const SHARED = new Set(["Tracker Date", "Aggregation"]); // bound on other tiles — kept

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Occurrence, Module, Field } = models;
  const mod = await Module.findOne({ gridId, id: TILE_MODULE }).lean();
  if (!mod || mod.label !== "Workouts") throw new Error("the Workouts tile module is not here");
  const ops = await Operation.find({ gridId }).lean();
  const op = ops.find((o) => o.name === OP_NAME);
  if (!op) throw new Error("op not found");
  const placements = await Occurrence.find({ gridId, moduleId: TILE_MODULE }).select("id").lean();
  const ids = placements.map((p) => p.id);
  const fields = await Field.find({ gridId, id: { $in: (mod.fieldBindings || []).map((b) => b.fieldId) } }).lean();
  const doomed = [];
  for (const f of fields) {
    if (SHARED.has(f.name)) continue;
    const bound = await Module.countDocuments({ gridId, id: { $ne: TILE_MODULE }, "fieldBindings.fieldId": f.id });
    const valued = await Occurrence.countDocuments({ gridId, id: { $nin: ids }, [`fields.${f.id}`]: { $exists: true } });
    const inOps = ops.filter((o) => o.id !== op.id && JSON.stringify([o.pipeline, o.triggers]).includes(f.id)).map((o) => o.name);
    if (bound || valued || inOps.length) throw new Error(`${f.name} is used elsewhere (bound ${bound}, valued ${valued}, ops ${inOps.join(", ")})`);
    doomed.push(f);
  }
  const elsewhere = ops.filter((o) => o.id !== op.id && JSON.stringify([o.pipeline, o.triggers]).match(new RegExp(`${TILE_MODULE}|${ids.join("|") || "^$"}`)));
  if (elsewhere.length) throw new Error(`another op names the tile: ${elsewhere.map((o) => o.name).join(", ")}`);
  log(`  op ${op.name} · tile placements ${ids.join(",")} · ${doomed.length} fields: ${doomed.map((f) => f.name).join(", ")}`);
  if (dryRun) return;
  await Operation.deleteOne({ gridId, id: op.id });
  await Occurrence.updateMany({ gridId, occurrences: { $in: ids } }, { $pull: { occurrences: { $in: ids } }, $set: { updatedAt: new Date() } });
  await Occurrence.deleteMany({ gridId, id: { $in: ids } });
  await Module.deleteOne({ gridId, id: TILE_MODULE });
  await Field.deleteMany({ gridId, id: { $in: doomed.map((f) => f.id) } });
  const left = await Promise.all([Operation.countDocuments({ gridId, id: op.id }), Occurrence.countDocuments({ gridId, $or: [{ id: { $in: ids } }, { occurrences: { $in: ids } }] }), Module.countDocuments({ gridId, id: TILE_MODULE }), Field.countDocuments({ gridId, id: { $in: doomed.map((f) => f.id) } })]);
  if (left.some(Boolean)) throw new Error(`left behind: ${left.join(",")}`);
  log("  applied. RESTART pm2.");
}
