/**
 * 0144 — day-column children carrying a STALE date are invisible.
 *
 * USER, 2026-08-19: *"the schedule for today only created 5am and beyond"*, then
 * *"a bunch of timeslots are still missing for today."*
 *
 * NOTHING WAS MISSING. Today's column holds all 48 half-hour slots, correctly
 * listed and in clock order, with 0 parented-but-unlisted. **21 of its 49
 * children carry `Date = 2026-08-18` — YESTERDAY** — and the page, the column
 * and the grid all filter on 2026-08-19, so the filter hides them.
 *
 * Driven through the REAL `isOccurrenceVisible` over the live data, with a
 * control (the same slot re-dated to today comes back visible, so the selector
 * is not simply rejecting everything):
 *
 *     VISIBLE 28   HIDDEN 21
 *     first visible          5:00am          <- "only 5am and beyond"
 *     hidden                 12:00am-4:30am
 *                            7:30am-12:00pm  <- "a bunch still missing"
 *
 * Both reports are the same defect seen from two positions in the day.
 *
 * THE REPAIR CLEARS THE DATE RATHER THAN RE-STAMPING IT, and that is the whole
 * decision. 28 of the 49 children carry NO date and render correctly — a slot
 * does not need one, because the COLUMN carries the day and the filter cascade
 * resolves visibility from there. Stamping today's date instead would work
 * today and go stale the same way tomorrow; it is also the exact trade
 * CLAUDE.md 2026-08-11 (2) refused for trackers, where a stamped date made the
 * row "vanish as soon as the user navigated past today". The 28 healthy
 * siblings are the evidence that no date is the right state.
 *
 * SCOPE IS STRUCTURAL AND NARROW: a child of a day column, carrying a date
 * that DISAGREES with its own column's date. A child dated to match its column
 * is left alone — this migration repairs staleness, it does not impose a policy
 * on rows that are already consistent. Anything that is not a day-column child
 * is never touched.
 *
 * IT IS RE-RUNNABLE ON PURPOSE. The durable cause is not fixed here — see the
 * note at the end of the run — so this may need running again until it is.
 *
 * AFTER APPLYING: restart pm2 AND reload the tab. The warm cache is
 * authoritative for reads, and a connected client can echo a stale copy back.
 */
export const id = "0144-stale-slot-dates";
export const describe = "Clear day-column children whose Date disagrees with their column's — the filter was hiding them.";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module } = models;

  const SF = grid?.meta?.scheduleFieldIds;
  if (!SF?.dateFieldId || !SF?.scheduleFormatFieldId) {
    log("  REFUSING: grid.meta.scheduleFieldIds is missing dateFieldId/scheduleFormatFieldId");
    return;
  }
  const DATE = SF.dateFieldId, FMT = SF.scheduleFormatFieldId, SLOT = SF.timeslotFieldId;

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));
  const labelOf = (o) => o?.label || modById.get(o?.moduleId)?.label || "?";
  const day = (v) => String(v ?? "").slice(0, 10);

  const dayCols = occs.filter(o => o.fields?.[FMT]?.value === "day-col");
  log(`  day columns: ${dayCols.length}`);
  if (!dayCols.length) { log("  nothing to do"); return; }

  // CONTROL: the date field must be in USE somewhere on this grid. A field id
  // that matches nothing would make every count below a confident zero.
  const anyDated = occs.filter(o => o.fields?.[DATE]?.value).length;
  if (!anyDated) {
    log(`  REFUSING: no occurrence on this grid carries field ${DATE} — the probe is broken, not the data`);
    return;
  }
  log(`  date-field control: ${anyDated} occurrences carry a date (probe works)`);

  const plan = [];
  for (const col of dayCols) {
    const colDate = day(col.fields?.[DATE]?.value);
    if (!colDate) { log(`  SKIP "${labelOf(col)}" — the column itself carries no date to compare against`); continue; }
    let ok = 0, none = 0;
    const stale = [];
    for (const cid of col.occurrences || []) {
      const child = byId.get(cid);
      if (!child) continue;
      const v = child.fields?.[DATE]?.value;
      if (v == null || v === "") { none++; continue; }
      if (day(v) === colDate) { ok++; continue; }
      stale.push({ child, was: day(v) });
    }
    log(`  "${labelOf(col)}" (${colDate}): ${none} undated · ${ok} matching · ${stale.length} STALE`);
    if (stale.length) {
      const shown = stale.slice(0, 24)
        .map(s => `${s.child.fields?.[SLOT]?.value || labelOf(s.child)}[${s.was}]`).join(", ");
      log(`      ${shown}${stale.length > 24 ? ` …+${stale.length - 24}` : ""}`);
      plan.push(...stale.map(s => s.child));
    }
  }

  if (!plan.length) { log("  no stale dates — already converged"); return; }
  log(`  clearing the Date value on ${plan.length} occurrence(s)`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const child of plan) {
    // Unset the KEY rather than writing null. `isEmptyVal` counts null as
    // empty either way, but an absent key is what the 28 healthy siblings
    // carry, and matching them exactly is the point of the repair.
    await Occurrence.updateOne({ id: child.id, gridId }, { $unset: { [`fields.${DATE}`]: "" } });
  }
  log(`  done — ${plan.length} cleared`);
  log("  NOTE: the durable cause is NOT fixed here. Whatever stamped yesterday's");
  log("  date onto a slot that survived into today's column will do it again;");
  log("  this migration is re-runnable for that reason.");
}
