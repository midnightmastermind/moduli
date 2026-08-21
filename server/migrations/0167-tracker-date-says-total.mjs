/**
 * 0167 — `Tracker Date` reads "Total" when no date filter is set.
 *
 * User: *"make sure with Tracker date, that it says Total if no filter is set for Date"*, and, asked
 * whether that should also change the NUMBER: *"aggregate all time and say Total. that makes the most
 * sense."*
 *
 * **THE NUMBERS ALREADY DID THAT — the label was the only part lying.** Measured before writing
 * anything: all 37 trackers carry `periodAllPolicy`'s `(date in period) OR (period IS_EMPTY)` wrapper,
 * so clearing the date already makes every tile aggregate all-time. Three of them still fell back to
 * today first; `0166` removed that. What remained is that the pill went on printing a dash, so a tile
 * showing an all-time total looked like a tile with no data.
 *
 * IT IS A FIELD FLAG, NOT AN OP CHANGE. `Trackers: Date-Prefix Labels` writes
 * `$goal.fields.<Tracker Date>.value = $activeDate` — so when the filter is cleared it already
 * writes an empty value. Nothing about the pipeline needs to change; the renderer simply had no way
 * to say what empty MEANS. `field.meta.emptyLabel` is that way, and it is generic: the renderer
 * learns nothing about trackers (which `noDomainKnowledge` enforces), and which field carries the
 * flag is data.
 *
 * WHY NOT REUSE `Tracker Scope`, which already reads "Total" on six tiles. That field marks a tile as
 * CUMULATIVE BY NATURE (`meta.cumulative` — the Financial totals from `0148`): it says Total whether
 * or not a date is set. This is the opposite condition — a normally-dated tile with the date cleared —
 * so folding them together would make a cumulative tile indistinguishable from an unfiltered one.
 * Both can be true at once and they mean different things.
 */
export const id = "0167-tracker-date-says-total";
export const describe = 'Sets meta.emptyLabel="Total" on Tracker Date so an unfiltered tracker reads Total instead of a dash.';

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module } = models;
  const f = await Field.findOne({ gridId, name: "Tracker Date" }).lean();
  if (!f) { log("  REFUSING: no Tracker Date field on this grid"); return; }

  const mods = await Module.find({ gridId }).lean();
  const bound = mods.filter((m) => (m.fieldBindings || []).some((b) => b.fieldId === f.id));
  log(`  Tracker Date (${f.id}) · type=${f.type} · bound by ${bound.length} module(s)`);

  if (f.meta?.emptyLabel === "Total") { log("  already converged"); return; }
  log(`  meta.emptyLabel: ${JSON.stringify(f.meta?.emptyLabel ?? null)} -> "Total"`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // $set on the one key, never the whole meta — the field may carry others.
  await Field.updateOne({ _id: f._id }, { $set: { "meta.emptyLabel": "Total" } });
  log("  done — RESTART pm2 and reload.");
}
