/**
 * 0176 — the Date pill on every timeslot.
 *
 * USER, 2026-08-21: *"and hide Date field on timeslots"*.
 *
 * ── WHY IT WAS SHOWING, which is the whole reason this is one write and not 48 ────────────────
 *
 * `fieldVisibility` is a NEAREST-WINS cascade and each level REPLACES the list above it. The grid
 * hides `[Tags, Date]`; the Schedule page hides `[Tags, Time Slot, Last Seen]` — so the moment the
 * walk reaches the Schedule page it stops, and **Date has been visible on everything under it** ever
 * since. The slots never had to opt in; they inherited a list that simply no longer names Date.
 *
 * So the fix is one entry on the page that already governs them, not a stamp on 48 slot containers —
 * which would also have to be re-stamped on every day column minted from here on, since a per-day
 * slot is a fresh COPY_LINK copy.
 *
 * ── IT MERGES, IT DOES NOT REPLACE ───────────────────────────────────────────────────────────
 *
 * The 2026-08-11 (2) rule, which this same page taught: *"an instruction about one field is not
 * permission to reset the others."* Time Slot and Last Seen stay hidden; Tags stays hidden; Date is
 * ADDED. Re-running finds Date already there and writes nothing.
 *
 * ── THE CONSEQUENCE, STATED RATHER THAN DISCOVERED LATER ─────────────────────────────────────
 *
 * This hides Date on every occurrence under the Schedule — the ROWS as well as the slot headers.
 * That is consistent with what the user has already asked for twice (2026-08-11 (3): *"the Date
 * display field ... shouldnt be shown on the container headers"* / *"the filter date is enough for
 * the containers"*): the day column's own title carries the date, so every pill under it repeats it.
 * **Nothing about the stored VALUES changes** — every tracker reads `fields.<Date>.value` and is
 * completely unaffected by whether a pill is drawn.
 */
export const id = "0176-hide-date-on-slots";
export const describe = "Add Date to the Schedule page's hide list — it was inherited-visible on every slot.";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Field } = models;
  const DATE = grid?.meta?.scheduleFieldIds?.dateFieldId;
  const PAGE = grid?.meta?.scheduleFieldIds?.pageOccurrenceId;
  if (!DATE || !PAGE) { log("  REFUSING: this grid has no scheduleFieldIds.dateFieldId / pageOccurrenceId"); return; }

  const page = await Occurrence.findOne({ id: PAGE, gridId }).lean();
  if (!page) { log(`  REFUSING: no Schedule page occurrence ${PAGE}`); return; }

  const fields = await Field.find({ gridId }).lean();
  const fn = (id) => fields.find((f) => f.id === id)?.name || id;

  const fv = page.fieldVisibility;
  if (fv && fv.mode !== "hide") {
    // A `show` list is a WHITELIST — adding Date to it would REVEAL it, the exact
    // inversion that broke the trackers in 2026-08-11. Refuse rather than guess.
    log(`  REFUSING: the Schedule page's fieldVisibility is mode "${fv.mode}", not "hide" — adding to it would do the opposite`);
    return;
  }
  const before = Array.isArray(fv?.fieldIds) ? fv.fieldIds : [];
  log(`  Schedule page hides: [${before.map(fn).join(", ") || "(nothing)"}]`);
  if (before.includes(DATE)) { log("  Date already hidden — nothing to do"); return; }

  const after = [...before, DATE];
  log(`  -> [${after.map(fn).join(", ")}]`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }
  await Occurrence.updateOne({ id: PAGE, gridId },
    { $set: { fieldVisibility: { mode: "hide", fieldIds: after } } });
  log("  written — RESTART pm2 and reload.");
}
