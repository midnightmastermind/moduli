/**
 * 0184 — the `Macros` tile could never fill, because nothing writes THAT occurrence.
 *
 * USER, 2026-08-21 and again 2026-08-22: *"the macros for meals arent working"* /
 * *"the meal macros or the meals werent updating (the trackers)"*.
 *
 * ── THE MATHS WAS NEVER WRONG, AND MEASURING IS THE ONLY REASON I KNOW ──────────────────────
 *
 * Reading the database says every macro total on the Trackers page is `0`, which reads exactly
 * like a dead operation. It is not. These are DISPLAY fields, recomputed on every load, so the
 * value sitting in Mongo is the last run's residue and not what the tile shows. Driven through
 * the REAL executor over a fixture exported from the live grid minutes before:
 *
 *     Meal Nutrition          Total Protein 23 · Calories 305 · Carbs 35 · Fats 7     WORKS
 *     Vitamins & Minerals     all fifteen totals                                       WORKS
 *     Intake                  Meal Count 1                                             WORKS
 *
 * Those are today's one completed meal, correct to the gram. **Reading Mongo alone would have
 * called three working trackers broken** — and that is the second time this week the database
 * has disagreed with the running app about a display field.
 *
 * ── WHAT IS ACTUALLY BROKEN IS A FOURTH TILE, AND IT IS INERT BY CONSTRUCTION ────────────────
 *
 * `Macros` sits beside `Meal Nutrition` under `Today's Nutrition` and binds the same four
 * fields — `Total Calories`, `Total Protein`, `Total Carbs`, `Total Fats`. Grepping every stored
 * pipeline for its occurrence id returns **nothing**:
 *
 *     ops naming the Macros tile id ......................... 0
 *     ops writing those four field NAMES ................... 1   (`Meal Nutrition`)
 *     ...onto which occurrence ............................. `$goalItem` = the Meal Nutrition tile
 *
 * A field value lives on an OCCURRENCE. Writing `Total Protein` on one tile does not put a
 * number on another tile that merely binds the same field. So `Macros` has been empty since the
 * day it was minted and would have stayed empty forever. **The inert-token class, in data form**
 * — a control that looks live, reads correctly in every log line, and is fed by nothing.
 *
 * ── IT IS RETIRED RATHER THAN FED, WHICH IS THE USER'S CALL ─────────────────────────────────
 *
 * Asked before writing, with both options costed. Pointing a second op at it would give two
 * tiles showing four identical numbers; `Meal Nutrition` already shows exactly those totals and
 * is proven working. So the duplicate goes, and the surviving tile is the one with a writer.
 *
 * ── THE REFUSALS ARE THE WHOLE SAFETY, and each one is a way this could destroy something ────
 *
 * A migration that deletes is judged by what it declines to delete. This one REFUSES unless
 * every one of these holds, and reports which failed:
 *
 *   1. the tile carries no non-empty field value  — anything typed there is the user's
 *   2. it has no children                          — a subtree is never collateral
 *   3. no operation names its id                   — the 0035 selector lesson
 *   4. no occurrence references it in a field value — the third reachability path 2026-08-13 (4)
 *      was paid for missing
 *   5. exactly one parent lists it                 — a multi-parented row is shared, not spare
 *
 * The module goes with it ONLY if it places nothing else (measured: 0 other occurrences), which
 * is the same predicate `sweepOrphans` uses rather than a second opinion that drifts from it.
 */
export const id = "0184-retire-the-inert-macros-tile";
export const describe =
  "Delete the `Macros` tracker tile — it binds four fields no operation writes on that occurrence, so it can never fill. Refuses if it holds a value, has children, or is referenced anywhere.";

/**
 * A value written by an OPERATION is the app's own footprint; a value in a field no operation
 * writes is the only kind the user can have typed. That distinction is the whole safety of the
 * guard, and getting it wrong is a mistake `0038` made TWICE — its first attempt scored field
 * values, fired on the date `0037` had just stamped, and refused to delete anything forever.
 * This one made the same mistake on its first dry run: the tile's ONLY value is
 * `Tracker Date = 2026-08-22`, written by `Trackers: Date-Prefix Labels` seconds after a
 * restart. Reported rather than quietly widened.
 */
export function appWrittenFieldIds(ops) {
  const ids = new Set();
  const blob = JSON.stringify(ops.map((o) => o.pipeline || {}));
  for (const m of blob.matchAll(/fields\.([A-Za-z0-9_-]{6,})\.value/g)) ids.add(m[1]);
  return ids;
}

/** Structural, never by label: a tracker tile bound to fields that no op writes ON THIS occurrence. */
export function isInertDuplicate(tile, { ops, occs, mods }) {
  const reasons = [];
  const appWritten = appWrittenFieldIds(ops);
  const vals = Object.entries(tile.fields || {}).filter(([k, v]) => v?.value != null && v.value !== "" &&
    !(Array.isArray(v.value) && v.value.length === 0) && !appWritten.has(k));
  if (vals.length) reasons.push(`carries ${vals.length} field value(s) NO operation writes — possibly typed by the user`);
  if ((tile.occurrences || []).length) reasons.push(`has ${(tile.occurrences || []).length} child/children`);
  const blob = ops.map((o) => JSON.stringify(o.pipeline || {}));
  if (blob.some((b) => b.includes(tile.id))) reasons.push("an operation names its id");
  if (occs.some((o) => o.id !== tile.id && JSON.stringify(o.fields || {}).includes(tile.id)))
    reasons.push("an occurrence references it in a field value");
  const listers = occs.filter((o) => (o.occurrences || []).includes(tile.id));
  if (listers.length !== 1) reasons.push(`listed by ${listers.length} parents, expected exactly 1`);
  return { ok: reasons.length === 0, reasons, lister: listers[0] || null };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation, Field } = models;
  const [occs, mods, ops, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Operation.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const tile = occs.find((o) => nameOf(o) === "Macros" && modById.get(o.moduleId)?.role === "instance");
  if (!tile) { log("  no `Macros` tile on this grid — nothing to do"); return; }

  // Prove the premise before acting on it: the four fields it binds must be written by some op,
  // but never onto THIS occurrence. If an op does write it, the premise is stale — refuse.
  const bound = (modById.get(tile.moduleId)?.fieldBindings || [])
    .map((b) => fields.find((f) => f.id === b.fieldId)).filter(Boolean);
  log(`  Macros (${tile.id}) binds: ${bound.map((f) => f.name).join(", ")}`);
  const writers = new Set();
  for (const f of bound) for (const o of ops)
    if (JSON.stringify(o.pipeline || {}).includes(`.fields.${f.id}.value`)) writers.add(o.name);
  log(`  those fields ARE written by: ${[...writers].join(", ") || "(nothing)"} — but not onto this tile`);

  const { ok, reasons, lister } = isInertDuplicate(tile, { ops, occs, mods });
  if (!ok) { log(`  REFUSING to delete: ${reasons.join("; ")}`); return; }
  log(`  safe to remove — listed only by ${nameOf(lister)} (${lister.id})`);

  const mod = modById.get(tile.moduleId);
  const others = occs.filter((o) => o.moduleId === tile.moduleId && o.id !== tile.id).length;
  log(`  its module ${mod?.id} places ${others} other occurrence(s)${others ? " — module KEPT" : " — module removed too"}`);

  if (dryRun) { log("  (dry run — nothing written)"); return; }
  await Occurrence.updateOne({ id: lister.id, gridId },
    { $pull: { occurrences: tile.id } });
  await Occurrence.deleteOne({ id: tile.id, gridId });
  if (!others && mod) await Module.deleteOne({ id: mod.id, gridId });
  log("  written — RESTART pm2 and reload.");
}
