// 0482 — "Media: Log Watch" stops walking the whole grid (review round 1 of Task 9).
//
// 0481 stored a pipeline that LOOPed over every occurrence (~37k on poms grid) on every load and date change, and ran a
// FIND over every occurrence for each candidate to ask "already logged?". The builder in 0481 now reads each shown
// day's watched rows through the executor's Last Watched day index and tests "already logged" against keys collected
// once per run. This rewrites the stored op's pipeline from that builder — same ids (read off the grid exactly as 0481
// does), same triggers, same behaviour. Idempotent; refuses if the op is missing. Deletes nothing.
import { logWatchPipeline, resolveIds, OP_NAME } from "./0481-media-log-watch.mjs";

export const id = "0482-media-log-watch-indexed";
export const describe = "Rewrites the 'Media: Log Watch' pipeline to read each day's watched rows from the day index (no whole-grid loop). Deletes nothing.";
export const touches = ["operations"];

/** Pure: { pipeline, changed } — the builder's pipeline for `ids`, kept from `op` when it is already that pipeline. */
export function rewriteLogWatchOp(op, ids) {
  if (!op) throw new Error(`REFUSING: no "${OP_NAME}" operation on this grid (run 0481 first)`);
  const fresh = logWatchPipeline(ids);
  const shape = (p) => JSON.stringify(p, (k, v) => (k === "id" ? undefined : v));
  if (shape(op.pipeline) === shape(fresh)) return { pipeline: op.pipeline, changed: false };
  return { pipeline: fresh, changed: true };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Field, Module, Occurrence, Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  const grid = await Grid.findById(gridId).lean();
  const [fields, modules] = await Promise.all([Field.find({ gridId }).lean(), Module.find({ gridId, label: "Watch" }).lean()]);
  const occurrences = await Occurrence.find({ gridId, moduleId: { $in: modules.map((m) => m.id) } }, { id: 1, moduleId: 1, meta: 1 }).lean();
  const ids = resolveIds({ grid, fields, modules, occurrences });
  const { pipeline, changed } = rewriteLogWatchOp(op, ids);
  const loops = (p) => (JSON.stringify(p).match(/"overExpr":"\$allOccurrences"/g) || []).length;
  log(`  op ${op.id}: ${changed ? `rewrite (whole-grid loops ${loops(op.pipeline)} -> ${loops(pipeline)})` : "already current"}`);
  if (!changed || dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline, updatedAt: new Date() } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  if (loops(after.pipeline) !== 0 || !JSON.stringify(after.pipeline).includes("ARRAY_NOT_INCLUDES") || rewriteLogWatchOp(after, ids).changed)
    throw new Error("readback: the stored pipeline is not the builder's");
  log("  applied and read back — RESTART pm2.");
}
