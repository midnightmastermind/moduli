// A deliberately inert first migration: it proves the runner's plumbing
// (discovery → dry run → snapshot → apply → bookkeeping) end to end without
// changing a single document. Safe to leave in place; safe to delete once a
// real migration exists.
export const id = "0001-verify-runner";
export const describe = "No-op. Counts occurrences to prove the runner reaches the grid. Deletes nothing.";

export async function up({ gridId, models, log, dryRun }) {
  const n = await models.Occurrence.countDocuments({ gridId });
  log(`${n} occurrence(s) visible in this grid`);
  if (dryRun) { log("dry run — no writes"); return; }
  log("no writes (this migration is inert by design)");
}
