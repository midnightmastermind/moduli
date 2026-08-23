/**
 * 0198 — a parent listing the same child twice.
 *
 * Found 2026-08-23 while repairing something else: `checkGrid` reported
 * `duplicate-template-section` on today's Day Page column —
 * `Journal×2, Notes×2, Tasks Completed×2, Highlights×2`.
 *
 * **They are not duplicated rows.** Each pair is the SAME occurrence id listed
 * twice in the parent's `occurrences[]`:
 *
 *     Journal   9c1e6524-…   <- entry 2
 *     Journal   9c1e6524-…   <- entry 7, same id
 *
 * So nothing was cloned and nothing holds writing to lose — the column simply
 * renders four of its sections twice. Measured grid-wide: **1 parent, 4
 * duplicate entries**, and every affected child was created in the same minute
 * (06:22), which is the shape of two passes appending concurrently.
 *
 * The write path now refuses this (`utils/childRefGuard.resolveChildRefs`
 * dedupes), so this migration repairs what is already stored.
 *
 * **FIRST ENTRY WINS.** On a day column the array IS the running order, and
 * keeping the later position would move the section down the page. `0137` had
 * to repair a rotated schedule once already.
 *
 * It deletes NOTHING — every id in the array survives, once.
 */
export const id = "0198-a-child-listed-twice";
export const describe =
  "De-duplicate any parent's occurrences[] that lists the same child more than once (1 parent, 4 entries on poms grid). Removes no occurrence.";

/** Order-preserving de-duplication. Returns null when there was nothing to do. */
export function dedupeChildList(ids) {
  if (!Array.isArray(ids)) return null;
  const seen = new Set();
  const out = [];
  for (const id of ids) { if (seen.has(id)) continue; seen.add(id); out.push(id); }
  return out.length === ids.length ? null : out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occurrences, modules] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(modules.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const edits = [];
  for (const o of occurrences) {
    const next = dedupeChildList(o.occurrences);
    if (next) edits.push({ id: o.id, label: nameOf(o), before: o.occurrences.length, next });
  }
  if (!edits.length) { log("  nothing to do — no parent lists a child twice"); return; }
  for (const e of edits) log(`  ${e.label}: ${e.before} entries → ${e.next.length} (${e.before - e.next.length} repeat(s) removed)`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }
  for (const e of edits) await Occurrence.updateOne({ id: e.id, gridId }, { $set: { occurrences: e.next } });
  log(`  done — ${edits.length} parent(s) de-duplicated; no occurrence removed`);
}
