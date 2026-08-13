// server/migrations/0095-remove-wellness-score.mjs
//
// User, 2026-08-13: "get rid of wellness score tracker as well."
//
// IT IS A DEAD TILE, and that was measured rather than assumed. The 2026-07-07
// full-operations audit already recorded it — "Wellness Score occurrence is
// written by NO op (shows -/0 forever)" — and it is still true today:
//
//   module lINFCt1j "Wellness Score"  role=instance  occurrences=1
//     listed by "Today's Emotional", 0 children
//     binds Moods, Daily Water, Category, Tracker Date
//   referenced by 0 operations · 0 textmaps
//
// THE ZERO IS A MEASUREMENT, NOT AN ABSENT SIGNAL: the same scan finds 2
// operations referencing a live module id, so it can see references when they
// exist. That control is the difference between "nothing points at this" and "my
// probe cannot see pointers" — the trap this repo has recorded from several
// directions.
//
// It BINDS the Moods display field, which is why it looked like a mood tile; the
// tracker writes to a DIFFERENT occurrence, so this one has always rendered
// empty. Removing it cannot affect the tracker.
//
// UNLINK BEFORE DELETE. A parent renders `occurrences[]`, so deleting the row
// without pulling its id leaves a dangling child ref — the single most-repaired
// defect class on this grid.
export const id = "0095-remove-wellness-score";
export const describe = "Removes the Wellness Score tile, which no operation has ever written.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation } = models;
  const [occs, mods, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Operation.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const targets = mods.filter((m) => /^wellness score$/i.test((m.label || "").trim()));
  if (!targets.length) { log(`nothing named "Wellness Score" — no change.`); return; }

  const rows = occs.filter((o) => targets.some((m) => m.id === o.moduleId));
  const ids = [...targets.map((m) => m.id), ...rows.map((r) => r.id)];

  // REFUSE IF ANYTHING STILL POINTS AT IT — with a control, so a zero means
  // "no references" rather than "the scan is blind".
  const refOps = ops.filter((o) => ids.some((i) => JSON.stringify(o.pipeline || {}).includes(i)));
  const live = occs.find((o) => modById.get(o.moduleId)?.kind === "graph");
  const controlOps = ops.filter((o) => JSON.stringify(o.pipeline || {}).includes(live?.id || "__none__"));
  log(`operations referencing it: ${refOps.length} (control, a LIVE id: ${controlOps.length})`);
  if (refOps.length) {
    log(`REFUSING: ${refOps.map((o) => o.name).join(", ")} still reference it — nothing written.`);
    return;
  }
  const withChildren = rows.filter((r) => (r.occurrences || []).length);
  if (withChildren.length) {
    log(`REFUSING: ${withChildren.length} row(s) hold children — nothing written.`);
    return;
  }

  for (const r of rows) {
    const parents = occs.filter((p) => (p.occurrences || []).includes(r.id));
    log(`  row ${r.id.slice(0, 8)} listed by [${parents.map((p) =>
      p.label ?? modById.get(p.moduleId)?.label ?? p.id.slice(0, 8)).join(", ") || "nobody"}]`);
  }
  if (dryRun) {
    log(`WOULD unlink and delete ${rows.length} occurrence(s) and ${targets.length} module(s).`);
    return;
  }
  for (const r of rows) {
    await Occurrence.updateMany({ gridId, occurrences: r.id }, { $pull: { occurrences: r.id } });
    await Occurrence.deleteOne({ gridId, id: r.id });
  }
  for (const m of targets) await Module.deleteOne({ gridId, id: m.id });
  log(`removed the Wellness Score tile (${rows.length} occurrence(s), ${targets.length} module(s)).`);
}
