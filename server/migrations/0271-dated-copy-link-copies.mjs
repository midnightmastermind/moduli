/**
 * 0271 — repair the copies too, not just the master.
 *
 * `gridIntegrity`'s `dated-copy-link-source` rule — added alongside `0145` so a
 * recurrence would be LOUD rather than silently costing somebody a morning —
 * fired again on poms grid, 10 days later:
 *
 *     SOURCE LnLC5V1KIMt_ "Todo" (container/board) in "Schedule: Layout"
 *       Date = 2026-08-18            <- the grid FILTERS on Date
 *       6 copies, and ALL SIX inherited that date
 *
 * So the user's Todo list was hidden on every day except 2026-08-18. Measured
 * 2026-08-28, ten days of it. The CONTROL is what makes that unambiguous: of
 * the source's 48 siblings under the same slot template, **48 carry no date and
 * exactly one does** — the healthy shape is no date at all, which is why the
 * remedy is to CLEAR rather than to re-stamp with something better (stamping
 * works today and goes stale tomorrow — 2026-08-11 (2) refused that trade).
 *
 * WHY `0145` DID NOT COVER THIS. It clears the SOURCE, which stops the next
 * copy being born wrong; the copies that already exist are untouched — that was
 * `0144`'s job, and `0144` was written against one specific day's column. So the
 * pair only ever repaired one day. This does BOTH IN ONE PASS, which is the rule
 * CLAUDE.md 2026-07-30 (2) already states: *"repair the masters and the copies
 * in the same pass, or rebuild the copies."*
 *
 * THE DISCRIMINATOR IS WHAT MAKES IT SAFE, and it is the whole design: a copy is
 * cleared ONLY when its value EQUALS the source's. That is what "inherited"
 * means. A copy whose value differs is something the user or an op set
 * deliberately — a task genuinely placed on a day — and clearing it would be
 * data loss, so it is KEPT and REPORTED. This is the `0038` lesson from the
 * other direction: a guard that cannot tell the app's own footprint from the
 * user's writing either refuses forever or destroys something.
 *
 * SCOPED STRUCTURALLY, NAMING NO DOMAIN CONCEPT. Filter fields are read off the
 * grid's own `activeFilterValues` / `namedFilters[].conditions[].fieldId`, and
 * copies are found through `meta.copyLinkSource`. Nothing here learns what a
 * schedule, a timeslot or a Todo is — `noDomainKnowledge` stays satisfied.
 *
 * ONLY THE FILTER FIELDS ARE TOUCHED. The `Time Slot` value on these containers
 * is an IDENTITY MARKER that `Schedule: Build Schedule`, `Alarm` and
 * `Pomodoro: Start` all FIND by (2026-07-30); nulling it breaks all three.
 *
 * AFTER APPLYING: restart pm2 (the warm cache is authoritative for reads) and
 * reload the tab.
 */
export const id = "0271-dated-copy-link-copies";
export const describe = "Clear inherited filter values off copy-link COPIES as well as their sources.";

/** The fields this grid actually filters on, read off the grid itself. */
export function filterFieldIds(grid) {
  const ids = new Set(Object.keys(grid?.activeFilterValues || {}));
  for (const f of grid?.namedFilters || []) {
    for (const c of f?.conditions || []) if (c?.fieldId) ids.add(c.fieldId);
  }
  return ids;
}

const val = (occ, fid) => {
  const v = occ?.fields?.[fid]?.value;
  return v == null || v === "" ? null : v;
};

/**
 * PURE. Given every occurrence on the grid and the filter fields, decide what to
 * clear. Exported so the rule is testable without a database (the `0048` shape).
 *
 * @returns {{ sources: Array, copies: Array, kept: Array }}
 *   sources — the copy-link sources carrying a filter value
 *   copies  — copies that INHERITED it (same value) and should be cleared
 *   kept    — copies whose value DIFFERS: deliberate, reported, never touched
 */
export function planCopyLinkDateRepair(occurrences, filterFields) {
  const fids = [...filterFields];
  const sourceIds = new Set(occurrences.map(o => o?.meta?.copyLinkSource).filter(Boolean));
  const byId = new Map(occurrences.map(o => [o.id, o]));
  const copiesOf = new Map();
  for (const o of occurrences) {
    const s = o?.meta?.copyLinkSource;
    if (s) copiesOf.set(s, [...(copiesOf.get(s) || []), o]);
  }

  const sources = [], copies = [], kept = [];
  for (const sid of sourceIds) {
    const src = byId.get(sid);
    if (!src) continue;                       // a dangling source is 0144's business
    const carried = fids.filter(f => val(src, f) !== null);
    if (!carried.length) continue;
    sources.push({ id: src.id, fields: carried });
    for (const c of copiesOf.get(sid) || []) {
      const inherited = carried.filter(f => val(c, f) !== null && val(c, f) === val(src, f));
      const differs = carried.filter(f => val(c, f) !== null && val(c, f) !== val(src, f));
      if (inherited.length) copies.push({ id: c.id, sourceId: sid, fields: inherited });
      // A value the copy does NOT share with its source was set deliberately.
      for (const f of differs) kept.push({ id: c.id, sourceId: sid, field: f, value: val(c, f) });
    }
  }
  return { sources, copies, kept };
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
  const labelOf = (id) => { const o = byId.get(id); return o?.label || modById.get(o?.moduleId)?.label || "?"; };

  const { sources, copies, kept } = planCopyLinkDateRepair(occs, fids);

  if (!sources.length) { log("  no copy-link source carries a filter value — already converged"); return; }

  log(`  ${sources.length} source(s) carry a filter value; ${copies.length} copy/copies inherited it:`);
  for (const s of sources.slice(0, 12)) {
    const src = byId.get(s.id);
    const shown = s.fields.map(f => `${f}=${String(src.fields[f].value).slice(0, 10)}`).join(" ");
    const mine = copies.filter(c => c.sourceId === s.id).length;
    log(`      SOURCE "${labelOf(s.id)}" in "${labelOf(src.parentId)}"  ${shown}  (${mine} inherited copies)`);
  }
  if (kept.length) {
    log(`  KEEPING ${kept.length} copy value(s) that DIFFER from their source — set deliberately, not inherited:`);
    for (const k of kept.slice(0, 10)) log(`      "${labelOf(k.id)}"  ${k.field}=${String(k.value).slice(0, 10)}`);
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  let cleared = 0;
  for (const t of [...sources, ...copies]) {
    const unset = {};
    // Unset the KEY rather than writing null — an absent key is what the
    // never-stamped siblings carry, and matching them is the point.
    for (const f of t.fields) unset[`fields.${f}`] = "";
    await Occurrence.updateOne({ id: t.id, gridId }, { $unset: unset });
    cleared += t.fields.length;
  }
  log(`  done — cleared ${cleared} value(s) across ${sources.length} source(s) and ${copies.length} copy/copies`);
}
