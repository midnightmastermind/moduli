// server/migrations/0389-pomodoro-start-unlinked-stop-deletes.mjs
//
// poms' pomodoro flow had never produced a single row (0 occurrences carry a
// Pomodoro #), and two of its steps could not have worked once it did
// (found rebuilding it by clicking, 2026-10-03):
//   - "Pomodoro: Start" made a LINKED copy of the Pomodoro item, so every session
//     row would share Completed and Pomodoro Minutes with the source and every
//     other session — completing one would complete all of them.
//   - "Pomodoro: Stop" stored its DELETE target under `path`; the executor's
//     DELETE reads `itemIdExpr`, so Stop could never delete the open pomodoro.

export const id = "0389-pomodoro-start-unlinked-stop-deletes";
export const describe = "Pomodoro: Start makes an unlinked copy; Pomodoro: Stop's delete names its target as itemIdExpr.";
export const touches = ["operations"];

/** PURE. Rewrite every step config the predicate matches. */
export function mapSteps(steps, fn) {
  return (steps || []).map((s) => {
    const n = { ...s };
    if (s.type === "action" && s.config) n.config = fn(s.config);
    for (const k of ["then", "else", "body"]) if (s[k]) n[k] = mapSteps(s[k], fn);
    return n;
  });
}
export const unlinkCopies = (cfg) => (cfg.type === "COPY_LINK" ? { ...cfg, linked: false } : cfg);
export const deleteByItemIdExpr = (cfg) => {
  if (cfg.type !== "DELETE" || cfg.itemIdExpr || !cfg.path) return cfg;
  const { path, ...rest } = cfg;
  return { ...rest, itemIdExpr: path };
};

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const start = await Operation.findOne({ gridId, name: "Pomodoro: Start" }).lean();
  const stop = await Operation.findOne({ gridId, name: "Pomodoro: Stop" }).lean();
  if (!start || !stop) throw new Error("0389: Pomodoro: Start / Stop not found");
  const startSteps = mapSteps(start.pipeline.steps, unlinkCopies);
  const stopSteps = mapSteps(stop.pipeline.steps, deleteByItemIdExpr);
  log(`"Pomodoro: Start": COPY_LINK -> linked:false`);
  log(`"Pomodoro: Stop": DELETE path -> itemIdExpr`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: start.id }, { $set: { "pipeline.steps": startSteps } });
  await Operation.updateOne({ gridId, id: stop.id }, { $set: { "pipeline.steps": stopSteps } });
  log("done. Restart the server (pm2).");
}
