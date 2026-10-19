// 0423 — A manual option list lives under `optionsSource.values`; five seeded fields kept it under `options`.
//
// Found in the 2026-10-19 UI sweep: those dropdowns opened EMPTY. Every reader (optionsResolver, the Fields tab's
// option editor, a pick's "+ Add") reads `values`, and nothing has read `options` since the editor was built.
// Measured on prod 2026-10-19: Schedule Format on poms / test grid 1 / test grid 2, Cadence on both test grids.
//
//   Schedule Format  the stored list ["timeslot","shortened"] is not what the field holds — the operations write
//                    slot / day-col (and flat, combined for the >7-day and combined views). Measured in use on poms:
//                    slot 1849, day-col 22. So the list becomes the values the field can actually hold.
//   any other field  the stored list moves across unchanged.
//
// The stale `options` key is removed. Nothing is deleted from any occurrence.

export const id = "0423-manual-options-under-values";
export const describe = "Manual select fields that kept their option list under optionsSource.options get it under values (Schedule Format: slot / day-col / flat / combined). No occurrence is touched.";
export const touches = ["fields"];

export const SCHEDULE_FORMAT_VALUES = ["slot", "day-col", "flat", "combined"];

/** PURE. field → the optionsSource to write, or null when it needs nothing. */
export function plannedSource(field) {
  const src = field?.meta?.optionsSource;
  if (src?.mode !== "manual" || !("options" in src)) return null;
  const { options, ...rest } = src;
  const kept = Array.isArray(rest.values) && rest.values.length ? rest.values : null;
  const values = field.name === "Schedule Format" ? SCHEDULE_FORMAT_VALUES : (kept || (Array.isArray(options) ? options : []));
  return { ...rest, values };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const rows = await Field.find({ gridId: String(gridId), "meta.optionsSource.mode": "manual", "meta.optionsSource.options": { $exists: true } }).lean();
  log(`${rows.length} field(s) with their option list under optionsSource.options`);
  for (const f of rows) {
    const next = plannedSource(f);
    if (!next) continue;
    log(`  ${f.name}: ${JSON.stringify(f.meta.optionsSource.options)} -> values ${JSON.stringify(next.values)}`);
    if (dryRun) continue;
    await Field.updateOne({ _id: f._id }, { $set: { "meta.optionsSource": next } });
  }
  if (dryRun) return;
  const left = await Field.countDocuments({ gridId: String(gridId), "meta.optionsSource.options": { $exists: true } });
  if (left) throw new Error(`0423: ${left} field(s) still carry optionsSource.options`);
}
