/**
 * 0249 — the `Now` tile gets its clock back.
 *
 * User, 2026-08-25: *"what happened to my time fields as well"* / *"those are
 * gone from the now tracker tile"* / *"like current time"* / *"and time left"*.
 *
 * ── NOTHING WAS DELETED — THEY NEVER EXISTED ON THIS GRID ────────────────
 *
 * The seed authors two LIVE-CLOCK fields and binds both to the `Now` module:
 *
 *     currentTime    name "Now"        meta.liveSource "currentTime"
 *     timeCountdown  name "Time Left"  meta.liveSource "endOfDayCountdown"
 *
 * A fresh grid has them. poms grid does not — and the contrast is the whole
 * diagnosis:
 *
 * ```
 * test grid 2   183 fields   carrying meta.liveSource: 2   ("Now", "Time Left")
 * poms grid     290 fields   carrying meta.liveSource: 0   <- none, at all
 * ```
 *
 * poms grid's `Now` module (`sUy5zKLg9O31`) is not the seed's — it was minted
 * by the 2026-07-30 Stats restructure — and it carries only the two bindings
 * every tracker tile got later (`Category` from the category-scope pass,
 * `Tracker Date` from `0072`). The clock fields were never part of it, so the
 * tile has been a `Now` with no time in it since the day it was made.
 *
 * ── THEY ARE NOT INERT, AND THAT WAS CHECKED BEFORE MINTING ──────────────
 *
 * A field carrying a key nothing reads is this repo's most-repeated defect, so
 * the renderer was read first. `Field.jsx:497 useLiveFieldValue` implements
 * BOTH sources, ticks on a `setInterval` (1s, or 30s at "minutes"
 * granularity), and overrides the displayed value — no operation, no socket
 * write, no stored value. `endOfDayCountdown` even honours optional
 * `liveTargetTime` / `liveStartTime` bounds. So these two names are read by
 * shipped code today.
 *
 * ── FIELD DEFINITIONS ARE COPIED FROM THE SEED, NOT RE-INVENTED ──────────
 *
 * Same names, types, flags and meta — so a fresh grid and this one cannot
 * drift. `display` role, `inputEnabled: false`: the value is computed at
 * render and typing into it would mean nothing.
 *
 * The two fields are bound FIRST (order 0 and 1), because binding order is
 * render order and the clock is what the tile is FOR. The existing `Category`
 * and `Tracker Date` bindings are preserved and shift down — an instruction
 * about two fields is not permission to drop the others.
 *
 * Resolution is by `meta.liveSource`, not by name: the field is named "Now",
 * and so is the module and the occurrence. Idempotent — a second run finds
 * both fields and both bindings and writes nothing.
 */

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export const id = "0249-now-tile-live-clock";
export const describe =
  "Mints the two live-clock fields (Now / Time Left) the seed gives every grid and binds them to the Now tracker tile. poms grid carries ZERO fields with meta.liveSource — they were never minted here.";
export const touches = ["fields", "modules"];

/** Copied from the seed's `fields.currentTime` / `fields.timeCountdown`. */
export const LIVE_FIELDS = Object.freeze([
  {
    key: "currentTime", name: "Now", type: "text",
    inputEnabled: false, displayEnabled: true,
    meta: { liveSource: "currentTime", liveGranularity: "seconds", flow: "in" },
    displayConfig: {},
  },
  {
    key: "timeCountdown", name: "Time Left", type: "text",
    inputEnabled: false, displayEnabled: true,
    meta: { liveSource: "endOfDayCountdown", liveGranularity: "seconds", flow: "out" },
    displayConfig: {},
  },
]);

/**
 * Which module is the Now tile, and what is missing from it. Pure.
 * Resolves the tile STRUCTURALLY where it can: an instance module labelled
 * "Now" that a tracker-stats container places. Refuses if ambiguous.
 */
export function planNowClock({ fields, modules, occurrences }) {
  const refusals = [];
  const bySource = new Map();
  for (const f of fields) if (f.meta?.liveSource) bySource.set(f.meta.liveSource, f);

  const tiles = modules.filter((m) => m.role === "instance" && m.label === "Now");
  if (tiles.length === 0) { refusals.push('no instance module labelled "Now" on this grid'); return { refusals }; }
  if (tiles.length > 1) { refusals.push(`${tiles.length} instance modules are labelled "Now" — ambiguous`); return { refusals }; }
  const tile = tiles[0];

  const missingFields = LIVE_FIELDS.filter((f) => !bySource.has(f.meta.liveSource));
  const bound = new Set((tile.fieldBindings || []).map((b) => b.fieldId));
  const alreadyBound = LIVE_FIELDS.filter((f) => {
    const existing = bySource.get(f.meta.liveSource);
    return existing && bound.has(existing.id);
  }).length;

  const placements = occurrences.filter((o) => o.moduleId === tile.id).length;
  return { tile, missingFields, alreadyBound, existingBySource: bySource, placements, refusals };
}

/** The tile's new binding list: clock first, everything it already had after. */
export function buildBindings(tile, fieldIdsInOrder) {
  const keep = (tile.fieldBindings || []).filter((b) => !fieldIdsInOrder.includes(b.fieldId));
  const head = fieldIdsInOrder.map((fieldId, i) => ({ fieldId, role: "display", order: i }));
  return [...head, ...keep.map((b, i) => ({ ...b, order: head.length + i }))];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Grid } = models;
  const [fields, modules, occurrences, grid] = await Promise.all([
    Field.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).lean(), Grid.findById(gridId).lean(),
  ]);

  const plan = planNowClock({ fields, modules, occurrences });
  if (plan.refusals.length) { for (const r of plan.refusals) log(`  REFUSING — ${r}`); return; }

  log(`Now tile: module ${plan.tile.id}, ${plan.placements} placement(s), ${(plan.tile.fieldBindings || []).length} existing binding(s)`);
  log(`  fields on this grid carrying meta.liveSource: ${plan.existingBySource.size}`);
  log(`  clock fields to mint: ${plan.missingFields.length}   already bound to the tile: ${plan.alreadyBound}`);

  if (!plan.missingFields.length && plan.alreadyBound === LIVE_FIELDS.length) {
    log("  already has its clock — nothing to do."); return;
  }
  if (dryRun) {
    for (const f of plan.missingFields) log(`    would mint "${f.name}" (${f.meta.liveSource})`);
    log(`    would bind ${LIVE_FIELDS.length} clock field(s) FIRST, keeping ${(plan.tile.fieldBindings || []).length} existing binding(s)`);
    log("DRY RUN — nothing written."); return;
  }

  const idsInOrder = [];
  for (const spec of LIVE_FIELDS) {
    let f = plan.existingBySource.get(spec.meta.liveSource);
    if (!f) {
      f = { id: uid(), userId: grid.userId, gridId, name: spec.name, type: spec.type,
            inputEnabled: spec.inputEnabled, displayEnabled: spec.displayEnabled,
            meta: spec.meta, displayConfig: spec.displayConfig };
      await Field.create(f);
      log(`  minted field "${spec.name}" ${f.id} (liveSource=${spec.meta.liveSource})`);
    } else log(`  reusing existing field "${f.name}" ${f.id}`);
    idsInOrder.push(f.id);
  }

  const next = buildBindings(plan.tile, idsInOrder);
  await Module.updateOne({ gridId, id: plan.tile.id }, { $set: { fieldBindings: next } });
  log(`  bound the clock to the Now tile — ${next.length} binding(s): ${next.map((b) => b.fieldId.slice(0, 6)).join(", ")}`);
}
