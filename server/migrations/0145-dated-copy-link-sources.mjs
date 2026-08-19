/**
 * 0145 — a COPY-LINK SOURCE carrying a filter value stamps every copy it mints.
 *
 * THE DURABLE HALF OF `0144`. That one cleared 21 stale dates off TODAY's
 * schedule column, which unblocked today and fixed nothing: the copies were
 * born that way. Tracing each one back through `meta.copyLinkSource`:
 *
 *     today's column child  ->  source          source's Date
 *     12:00am                   "12:00am"       2026-08-18     <- in "Day"
 *     ... 21 of them, every one a child of the slot template "Day"
 *
 * **The template itself carries yesterday's date on 21 of its 55 nodes**, and
 * COPY_LINK copies a source's fields — so every day column minted from it
 * inherits a date that is already wrong, and the filter hides those slots the
 * moment the day rolls over. The user saw it as "the schedule only created 5am
 * and beyond" and then "a bunch of timeslots are still missing".
 *
 * This is the class CLAUDE.md 2026-07-30 (2) already records in one line: *"a
 * data repair on a MASTER propagates into every per-day copy minted afterwards
 * — repair the masters and the copies in the same pass, or rebuild the copies."*
 * `0144` repaired the copies. This repairs the master.
 *
 * SCOPED STRUCTURALLY, AND IT NAMES NO DOMAIN CONCEPT. The rule is: an
 * occurrence that some other occurrence copy-links FROM must not carry a value
 * in a field the grid FILTERS on. The filter fields are read off the grid's own
 * `activeFilterValues` keys and `namedFilters[].conditions[].fieldId` — data the
 * grid states about itself, not a constant this file knows. Nothing here learns
 * what a schedule or a timeslot is.
 *
 * MEASURED BEFORE WRITING, including a control on a second grid:
 *     poms grid      51 copy-link sources · 21 carry a filter value
 *     test grid 1    61 copy-link sources ·  0 carry one   <- the healthy shape
 *     test grid 2     0 copy-link sources ·  0
 * A grid with 61 sources and none dated is what says the fix is "clear it", not
 * "stamp it with something better".
 *
 * WHAT STAMPED THEM ON 2026-08-18 IS NOT ESTABLISHED, and is deliberately not
 * guessed at here. `gridIntegrity` gains a `dated-copy-link-source` rule in the
 * same change, so a recurrence is REPORTED rather than silently propagating for
 * a day before somebody notices their morning is missing.
 *
 * AFTER APPLYING: restart pm2 and reload the tab.
 */
export const id = "0145-dated-copy-link-sources";
export const describe = "Clear filter values off copy-link SOURCES — they were stamping every per-day copy.";

/** The fields this grid actually filters on, read off the grid itself. */
export function filterFieldIds(grid) {
  const ids = new Set(Object.keys(grid?.activeFilterValues || {}));
  for (const f of grid?.namedFilters || []) {
    for (const c of f?.conditions || []) if (c?.fieldId) ids.add(c.fieldId);
  }
  return ids;
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module } = models;

  const fids = filterFieldIds(grid);
  if (!fids.size) { log("  REFUSING: this grid names no filter fields — nothing to reason about"); return; }
  log(`  filter fields: ${[...fids].join(", ")}`);

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));
  const labelOf = (o) => o?.label || modById.get(o?.moduleId)?.label || "?";

  // Every occurrence that something copy-links FROM.
  const sourceIds = new Set(occs.map(o => o.meta?.copyLinkSource).filter(Boolean));
  log(`  copy-link sources: ${sourceIds.size}`);
  if (!sourceIds.size) { log("  nothing copy-links on this grid — nothing to do"); return; }

  const plan = [];
  for (const id of sourceIds) {
    const src = byId.get(id);
    if (!src) continue;                       // a dangling source is 0144's business, not this
    const carried = [...fids].filter(f => {
      const v = src.fields?.[f]?.value;
      return v != null && v !== "";
    });
    if (carried.length) plan.push({ src, carried, copies: occs.filter(o => o.meta?.copyLinkSource === id).length });
  }

  if (!plan.length) { log("  no copy-link source carries a filter value — already converged"); return; }
  log(`  ${plan.length} source(s) carry a filter value, and every copy inherits it:`);
  for (const p of plan.slice(0, 24)) {
    const shown = p.carried.map(f => `${f}=${String(p.src.fields[f].value).slice(0, 10)}`).join(" ");
    log(`      "${labelOf(p.src)}" in "${labelOf(byId.get(p.src.parentId))}"  ${shown}  (${p.copies} copies)`);
  }
  if (plan.length > 24) log(`      …+${plan.length - 24} more`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  let cleared = 0;
  for (const p of plan) {
    const unset = {};
    // Unset the KEY rather than writing null — an absent key is what the
    // sources that were never stamped carry, and matching them is the point.
    for (const f of p.carried) unset[`fields.${f}`] = "";
    await Occurrence.updateOne({ id: p.src.id, gridId }, { $unset: unset });
    cleared += p.carried.length;
  }
  log(`  done — cleared ${cleared} value(s) across ${plan.length} source(s)`);
  log("  `gridIntegrity` now reports this class as an error, so a recurrence is loud.");
}
