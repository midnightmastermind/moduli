/**
 * 0182 — the `Day` template is carrying a date again, and this time the RECURRENCE is timestamped.
 *
 * `0145` cleared exactly this on 2026-08-19 and its header closed with the honest gap:
 * *"WHAT STAMPED THE TEMPLATE ON 2026-08-18 IS NOT ESTABLISHED, and is deliberately not guessed
 * at. The integrity rule is the answer to not knowing."* The rule did its job — `checkGrid` went
 * from 1 error to 2 the moment it recurred — and the recurrence carries evidence `0145` did not
 * have:
 *
 *   - **10 slots, not 21**, and they are contiguous: `Todo`, then `12:00am` through `4:30am`.
 *   - Every one `updatedAt` **05:59:15**, seconds after a pm2 restart, i.e. during the FIRST grid
 *     load that followed it — not during a migration, and not spread over a day.
 *
 * A contiguous early-morning band written in one second by a page load is a much narrower target
 * than "something, sometime". It is still not proof of WHICH op, so this migration repairs and
 * does not theorise; the finding is filed with the timestamp so the next pass starts from it.
 *
 * ── IT CLEARS RATHER THAN RE-STAMPS, for `0145`'s reason ────────────────────────────────────
 *
 * A slot's date belongs to the COLUMN it is placed in; the cascade resolves visibility from there.
 * Stamping today onto the template works today and is wrong tomorrow. And it clears ONLY the field
 * the grid filters on — the `Time Slot` identity marker is untouched, because `Build Schedule`,
 * `Alarm` and `Pomodoro: Start` all FIND their slot by that value and nulling it breaks all three
 * (2026-07-30).
 *
 * Scoped structurally: an occurrence that something copy-links FROM, carrying a value in a field
 * the grid filters on. Nothing here names a schedule, a slot, or a template.
 */
export const id = "0182-clear-day-template-dates-again";
export const describe =
  "Clear the filtered date field on copy-link SOURCES that carry one (the `Day` template's slots). " +
  "Touches only that field — identity markers and every other value are left alone.";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map((m) => [m.id, m]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;

  // The fields the grid actually filters on, read off the grid rather than named.
  const filterFields = new Set(Object.keys(grid?.activeFilterValues || {}));
  for (const f of grid?.namedFilters || [])
    for (const c of f.conditions || []) if (c?.fieldId) filterFields.add(c.fieldId);
  if (!filterFields.size) { log("  REFUSING: the grid filters on nothing — no field to clear"); return; }

  const sources = new Set(occs.map((o) => o.meta?.copyLinkSource).filter(Boolean));
  const hits = [];
  for (const o of occs) {
    if (!sources.has(o.id)) continue;
    for (const fid of filterFields) {
      const v = o.fields?.[fid]?.value;
      if (v != null && v !== "") hits.push({ occ: o, fid, v });
    }
  }
  log(`  filter fields: ${[...filterFields].join(", ")}`);
  log(`  copy-link sources carrying one: ${hits.length}`);
  for (const h of hits) log(`    ${lbl(h.occ)} (${h.occ.id})  ${h.fid}=${h.v}  updated=${h.occ.updatedAt}`);
  if (!hits.length) { log("  nothing to do"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const h of hits)
    await Occurrence.updateOne({ id: h.occ.id, gridId }, { $unset: { [`fields.${h.fid}`]: "" } });
  log(`  cleared ${hits.length} — RESTART pm2 so the warm cache re-reads.`);
}
