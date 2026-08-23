/**
 * 0197 — a day column its own page stopped listing.
 *
 * USER, 2026-08-23: *"the schedule didnt get created for today"* — and it HAD
 * been. Measured:
 *
 *     06:22  the column is created, parentId = the Schedule page, 49 slots
 *     06:52  the Schedule page is WRITTEN, and its occurrences[] is now []
 *            nobody lists the column
 *
 * A page renders `occurrences[]`, so a child that is correctly PARENTED but not
 * LISTED is present in the data and invisible on screen. Nothing was missing;
 * the column was orphaned from its own page half an hour after being built.
 *
 * **This is a RECURRENCE, and the same page.** 2026-08-07 (2) records it
 * verbatim — *"poms grid's Schedule page occurrence had `occurrences: []` while
 * the day column sat there with `parentId` pointing AT the page ... What
 * emptied it is still unknown."* It is still unknown. The documented mechanism
 * for the class is a client echoing a stale whole-array write back over the
 * live value (2026-08-13 (2)), which fits the 30-minute gap and the fact that
 * the write landed while a browser was reconnecting.
 *
 * ── IT RE-LINKS, IT NEVER RE-CREATES ────────────────────────────────────────
 *
 * The rows exist and hold the day's work. Rebuilding would mint a second column
 * beside the first — the duplicate-day-column class `0181` had to clean up.
 *
 * `$push` with a `$ne` guard, never a whole-array write: a read-modify-write on
 * the very field that got clobbered would race the same client again (`0111`'s
 * rule, learned the same way).
 *
 * ── SCOPED TO DAY COLUMNS, and the two Journals are REPORTED not adopted ────
 *
 * Three occurrences name the Schedule page as parent and only one is a day
 * column; the others are two `Journal` rows last touched 2026-08-22. A page
 * losing its column is a defect; a stray Journal parented there may be
 * deliberate, debris, or someone's dragged row, and adopting it would put
 * something on the Schedule that nobody asked for. The discriminator is
 * structural — it carries `Schedule Format: day-col` — not a label.
 */
export const id = "0197-relink-day-columns-their-page-lost";
export const describe =
  "Re-list any day column whose parentId names a page that no longer lists it. Pushes with a guard; creates nothing, deletes nothing.";

/** Day columns that are parented to a page which does not list them. */
export function unlistedDayColumns({ occurrences, scheduleFormatFieldId }) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const out = [];
  for (const o of occurrences) {
    if (o?.fields?.[scheduleFormatFieldId]?.value !== "day-col") continue;
    if (!o.parentId) continue;
    const parent = byId.get(o.parentId);
    if (!parent) continue;                                   // a missing parent is a different defect
    if ((parent.occurrences || []).includes(o.id)) continue; // already listed
    out.push({ column: o, parent });
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occurrences, modules, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const sf = fields.find((f) => f.name === "Schedule Format")?.id;
  if (!sf) { log("  REFUSING: no `Schedule Format` field"); return; }
  const modById = new Map(modules.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const hits = unlistedDayColumns({ occurrences, scheduleFormatFieldId: sf });
  if (!hits.length) { log("  nothing to do — every day column is listed by its page"); return; }
  for (const { column, parent } of hits) {
    log(`  ${nameOf(parent)} does not list ${nameOf(column)} (${(column.occurrences || []).length} slots) — re-linking`);
  }
  // Anything else parented there is reported, never adopted.
  for (const { parent } of hits) {
    const strays = occurrences.filter((o) => o.parentId === parent.id
      && o.fields?.[sf]?.value !== "day-col" && !(parent.occurrences || []).includes(o.id));
    for (const s of strays) log(`    LEAVING ${nameOf(s)} (${s.id}) — parented here but not a day column`);
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }
  for (const { column, parent } of hits) {
    await Occurrence.updateOne(
      { id: parent.id, gridId, occurrences: { $ne: column.id } },
      { $push: { occurrences: column.id } },
    );
  }
  log(`  done — ${hits.length} column(s) re-listed. Reload the tab: a stale array in a live client is what does this.`);
}
