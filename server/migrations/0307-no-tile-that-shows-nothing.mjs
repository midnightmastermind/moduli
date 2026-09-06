// Two tracker tiles rendered as empty boxes.
//
// User, 2026-09-06: *"get rid of the empty tracker tiles"*.
//
//   Liquid Intake     an instance tile with ZERO visible field bindings
//   Today's Planning  a container with no children
//
// ── ONE OF THEM IS MINE, FROM THIS MORNING ─────────────────────────────────
//
// `0305` unbound four tiles from display fields another tile already owned, at
// the user's direction. Three of them had other fields and still render.
// `Liquid Intake` bound **only** `Daily Water`, so removing it left a tile with
// nothing at all — a blank box where there had been a blank number. Reported
// within the hour.
//
// ── AND IT IS NOT MERELY UNBOUND, IT IS DEAD ───────────────────────────────
//
// Measured before deleting rather than assumed, because a tile holding a value
// is a tile something still writes to:
//
//   * it carries `Meal Count = 1` and a `Tracker Date` — but **no operation
//     writes to it**: the only writer of `Meal Count` is `Nutrition: Today's
//     Micronutrients`, which does not name this occurrence, and the field is
//     bound by `Meal Log`, where it renders. Those two values are leftovers
//     from an earlier shape.
//   * no children, no textmap, one placement of its module.
//
// `Today's Planning` is simpler: no children, no values, no textmap. Its tiles
// were re-parented when the trackers were nested (2026-07-30) and the container
// was left behind.
//
// ── THE GUARDS ARE THE MIGRATION ───────────────────────────────────────────
//
// Deleting a tile that something still writes to turns a visible blank into an
// INVISIBLE one — the op keeps writing into a hole. So each candidate must be
// empty on every axis this grid uses to mean "in use", and the migration
// REFUSES rather than reporting if any of them is not:
//   no visible binding · no children · no textmap · no operation naming it ·
//   not embedded in anyone's textmap · its module placed exactly once.
//
// Unlinked from the parent BEFORE deletion — a row deleted while a parent still
// lists it is the dangling-child-ref class this repo has swept five times.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";
import fs from "node:fs";
import path from "node:path";

export const id = "0307-no-tile-that-shows-nothing";
export const description = "Remove the two tracker tiles that render nothing: an unbound instance and a childless container.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const NAMES = ["Liquid Intake", "Today's Planning"];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const mods = await Module.find({ gridId: gid }).lean();
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const ops = await Operation.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label;

  const opsJson = JSON.stringify(ops.map((o) => o.pipeline || {}));
  const textmaps = JSON.stringify(occs.map((o) => o.textmap || null));
  const placements = {};
  for (const o of occs) if (o.moduleId) placements[o.moduleId] = (placements[o.moduleId] || 0) + 1;

  const doomed = [];
  for (const name of NAMES) {
    const hits = occs.filter((o) => labelOf(o) === name);
    if (hits.length === 0) { log(`  ${name}: already gone`); continue; }
    if (hits.length !== 1) throw new Error(`"${name}": ${hits.length} occurrences - refusing to guess`);
    const occ = hits[0];
    const mod = modById[occ.moduleId];

    const visible = (mod?.fieldBindings || []).filter((b) => !b.hidden);
    const children = (occ.occurrences || []).length;
    const values = Object.entries(occ.fields || {})
      .filter(([, v]) => v?.value !== undefined && v?.value !== null && v?.value !== "");

    // Every axis this grid uses to mean "in use".
    if (visible.length) throw new Error(`"${name}" renders ${visible.length} field(s) - not empty; refusing`);
    if (children) throw new Error(`"${name}" has ${children} child(ren) - refusing`);
    if (occ.textmap) throw new Error(`"${name}" carries a textmap - refusing`);
    if (opsJson.includes(occ.id)) throw new Error(`"${name}" is named by an operation - deleting it would leave the op writing into a hole; refusing`);
    if (textmaps.includes(occ.id)) throw new Error(`"${name}" is embedded in a textmap - refusing`);
    if ((placements[occ.moduleId] || 0) > 1) throw new Error(`"${name}" shares its module with ${placements[occ.moduleId] - 1} other placement(s) - refusing`);

    const listers = occs.filter((o) => (o.occurrences || []).includes(occ.id));
    log(`  ${name}: ${occ.id} — 0 visible fields, 0 children, ${values.length} stale value(s) [${values.map(([k]) => k).join(", ") || "none"}], listed by ${listers.map(labelOf).join(", ") || "nobody"}`);
    doomed.push({ occ, mod, listers });
  }

  if (!doomed.length) { log("  nothing to remove."); return; }

  if (apply) {
    const dir = path.resolve("backups/orphans");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_empty-tiles.json`);
    fs.writeFileSync(file, JSON.stringify(doomed.map((d) => ({ occurrence: d.occ, module: d.mod })), null, 1));
    log(`  dumped ${doomed.length} tile(s) -> ${file}`);

    for (const d of doomed) {
      // UNLINK FIRST.
      await Occurrence.updateMany({ gridId: gid, occurrences: d.occ.id }, { $pull: { occurrences: d.occ.id } });
      await Occurrence.deleteOne({ id: d.occ.id, gridId: gid });
      // The module is placed exactly once (guarded above), so it is dead too.
      if (d.mod) await Module.deleteOne({ id: d.mod.id, gridId: gid });
    }
  }

  log(`  ${doomed.length} tile(s) ${apply ? "removed" : "would be removed"}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
