/**
 * 0172 — the day column's `Todo` container had NO identity marker, so due work was never placed.
 *
 * Found while measuring for the weekday-tasks work, not reported. `Schedule: Place Dated Work`
 * phase 2 resolves the day's Todo container by its `Time Slot` VALUE — the field-based identity
 * marker every schedule lookup uses since 2026-07-26 removed label matching:
 *
 *     FIND $allContainers where _ancestors HAS_ANCESTOR $dayColId
 *                            AND fields.<Time Slot>.value IS "Todo"     -> $dueId
 *     IF $dueId IS_NOT_EMPTY  ...place every due task...
 *
 * That value is **null** on the `Day` template's Todo, and COPY_LINK copies a source's fields — so
 * every day column ever minted from it carries a Todo with no marker, the FIND binds nothing, the
 * `IS_NOT_EMPTY` gate fails, and **the whole due-placement phase exits silently.** Nothing errors and
 * the op reports a clean run, which is exactly why it survived. Measured on poms grid:
 *
 *     signed `slot:Todo`   8 occurrences   7 weekday templates carry "Todo"   the Day master: null
 *     per-day COPIES       5 (copyLinkSource -> the master)                   all null
 *     tasks carrying a Due date, unplaced on today's column                   7
 *
 * THE SELECTOR IS THE SIGNATURE, NOT THE LABEL. `identitySignature: "slot:Todo"` is what the seven
 * correct weekday-template Todos and the master all share, and `meta.copyLinkSource` is what ties a
 * per-day copy back to that master. Matching on the label "Todo" would break on the next rename —
 * and this container has already been renamed once (`No timeslot` -> `Todo`, 2026-07-30 (7)), which
 * is the most likely moment the marker was lost.
 *
 * IT REPAIRS THE MASTER AND THE COPIES IN THE SAME PASS — the rule 2026-07-30 (2) paid for. Fixing
 * only the master fixes tomorrow and leaves today broken; fixing only today is undone by the next
 * build.
 *
 * ONLY EMPTY MARKERS ARE WRITTEN. A Todo already carrying "Todo" is left exactly as it is, so a
 * re-run is a no-op and the seven weekday templates are never touched.
 *
 * ── NO NEW INTEGRITY RULE, AND THE MEASUREMENT IS WHY ──────────────────────────────────────────
 *
 * The obvious durable guard is "occurrences sharing an identitySignature must not disagree about a
 * field value one of them has and the others do not". It was written and run over all six grids
 * before being committed to, and it is NOISE: **26 hits on poms grid and 8 on test grid 2, of which
 * exactly ONE is this defect.** The rest are `Last Seen` and `Date` — per-day values that are
 * SUPPOSED to differ between a template node and its dated copy. A guard that cries wolf on the day
 * it ships is one somebody weakens later, so it is not shipped.
 *
 * REPORTED, NOT FIXED: that same probe found `Last Seen = 2026-08-18` on all 49 `Day`-template slot
 * SOURCES, stamping every per-day copy with a fixed date. It is the `dated-copy-link-source` class
 * (2026-08-19 (5)) one field over — `Last Seen` is not one of the grid's filter fields, so `0145`
 * correctly did not clear it. Harmless to the schedule build; it wants its own look.
 */
const SIG = "slot:Todo";
const MARKER = "Todo";

export const id = "0172-todo-lost-its-identity";
export const describe =
  "Restore the day column's Todo identity marker on the Day template and every copy — due placement had been a silent no-op.";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map((m) => [m.id, m]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;

  const TS = grid?.meta?.scheduleFieldIds?.timeslotFieldId;
  if (!TS) { log("  REFUSING: this grid has no scheduleFieldIds.timeslotFieldId"); return; }

  const signed = occs.filter((o) => o.identitySignature === SIG);
  if (!signed.length) { log(`  nothing signed "${SIG}" on this grid — nothing to repair`); return; }

  // The MASTER is the signed node that others copy-link from. Resolved from the
  // copies rather than by label, so a rename cannot mislead it.
  const sourceIds = new Set(occs.map((o) => o.meta?.copyLinkSource).filter(Boolean));
  const masters = signed.filter((o) => sourceIds.has(o.id));
  const copies = masters.length
    ? occs.filter((o) => masters.some((m) => o.meta?.copyLinkSource === m.id))
    : [];

  const isEmpty = (v) => v == null || v === "";
  const broken = [...signed, ...copies].filter((o) => isEmpty(o.fields?.[TS]?.value));
  const already = [...signed, ...copies].filter((o) => o.fields?.[TS]?.value === MARKER);

  log(`  signed "${SIG}": ${signed.length} · master(s): ${masters.length ? masters.map((m) => m.id).join(", ") : "none"} · copies: ${copies.length}`);
  log(`  already correct: ${already.length} · to repair: ${broken.length}`);
  for (const o of broken) {
    const listedBy = occs.filter((x) => (x.occurrences || []).includes(o.id)).map(lbl);
    log(`    ${o.id}  parent=${lbl(occs.find((x) => x.id === o.parentId)) || "(none)"}  listedBy=${listedBy.join(",") || "(nobody)"}  children=${(o.occurrences || []).length}`);
  }
  if (!broken.length) { log("  nothing to do"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const o of broken) {
    await Occurrence.updateOne(
      { id: o.id, gridId },
      { $set: { [`fields.${TS}`]: { value: MARKER, flow: "in" } } },
    );
  }
  log(`  repaired ${broken.length} — RESTART pm2 so the warm cache re-reads them.`);
}
