/**
 * 0266 — a parent listing a child that does not exist.
 *
 * `occurrences[]` is the render order; `parentId` is the home. A row is
 * reachable through both, so DELETING the document without pulling its id out
 * of the parent's array leaves a pointer at nothing.
 *
 * ── WHY THIS EXISTS: I CAUSED 257 OF THEM ───────────────────────────────
 * `0265` removed 257 duplicate book rows and did not unlist them first. That
 * migration is fixed, so a grid that has not run it yet gets no damage and this
 * sweep finds nothing — but poms grid ran the pre-fix version and its Books
 * board was left listing 257 ids that resolve to no document.
 *
 * This repo has swept this class by hand at least five times (2026-07-29,
 * 07-30, 07-31, 08-03, 08-04) and root-caused it twice. It has never had a
 * migration. It does now, and it is general rather than book-specific, because
 * the next cause will not be books.
 *
 * ── IT ONLY EVER REMOVES IDS THAT RESOLVE TO NOTHING ────────────────────
 * The predicate is the narrowest possible: an id in some parent's
 * `occurrences[]` for which no Occurrence document exists ANYWHERE on the grid.
 * It never reorders, never touches an id that resolves, and never deletes a
 * document. An occurrence that exists but is merely unreachable is a DIFFERENT
 * question (`sweepOrphans` owns it, and deliberately refuses to delete anything
 * holding content) and is left alone here.
 *
 * `$pull` per parent, so a concurrent write to a different parent cannot be
 * lost — the 2026-08-04 finding that a whole-array read-modify-write races.
 */

export const id = "0266-sweep-dangling-child-refs";
export const describe =
  "Pulls ids out of any occurrences[] array that point at no existing document. Removes nothing else, reorders nothing, and never deletes a document.";
export const touches = ["occurrences"];

/** Pure. `{ parentId, ids[] }` for every parent holding a dead reference. */
export function planDanglingSweep({ occurrences }) {
  const live = new Set(occurrences.map((o) => o.id));
  const out = [];
  for (const o of occurrences) {
    const kids = o.occurrences || [];
    if (!kids.length) continue;
    const dead = kids.filter((id) => !live.has(id));
    if (dead.length) out.push({ parentId: o.id, ids: dead, kept: kids.length - dead.length });
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  const occurrences = await Occurrence.find({ gridId }).lean();
  const plan = planDanglingSweep({ occurrences });
  const total = plan.reduce((a, p) => a + p.ids.length, 0);
  if (!total) { log("no dangling child refs."); return; }
  log(`${total} dead reference(s) across ${plan.length} parent(s):`);
  for (const p of plan.slice(0, 20)) log(`   ${p.parentId} — dropping ${p.ids.length}, keeping ${p.kept}`);
  if (plan.length > 20) log(`   …and ${plan.length - 20} more parent(s)`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  for (const p of plan) {
    await Occurrence.updateOne({ gridId, id: p.parentId }, { $pull: { occurrences: { $in: p.ids } } });
  }
  log(`pulled ${total} dead reference(s).`);
}
