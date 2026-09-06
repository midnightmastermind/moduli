// Four tracker tiles bound a display field nothing wrote to them, so they
// rendered an empty box forever.
//
//     Fitness Stats  :: Daily Steps       (written to "Steps")
//     Liquid Intake  :: Daily Water       (written to "Water")
//     Reading Stats  :: Pages Read        (written to "Pages Read")
//     Workout Log    :: Total Workouts    (written to "Fitness Stats")
//
// A tracker op is scoped to ONE goal occurrence, so the second tile to bind a
// field gets nothing, with no error anywhere.
//
// ── "SCOPE EACH TO ITS OWN TILE" WAS ASKED FOR AND CANNOT REACH THESE ──────
//
// The user chose that for the five in `0290`, and chose it again here. Measured
// against these four it does not translate, which is why they are being
// unbound instead:
//
//   * `Fitness Stats` and `Reading Stats` sit under the SAME parent as the tile
//     that already writes their field (`Steps`, `Pages Read`), so `0290`'s
//     dimension-derived tag is identical and a new tracker would compute the
//     duplicate the user rejected.
//   * `Liquid Intake` and `Workout Log` derive "nutrition" and "workout", and
//     NEITHER is a live `Tags` value (physical 98, intellectual 15, social 13,
//     emotional 12 ... neither appears once). The gate would sum nothing and
//     the tile would read **0 instead of blank** - worse, because a wrong
//     number reads as a real one.
//   * Ancestor-scoping does not help either: the rows a tracker counts live
//     under the SCHEDULE, not under the tracker container, so the tile's own
//     parent is not a scope on the data.
//
// Asked with those measurements in hand, the user chose: **unbind all four.**
// Each number then lives in exactly one place.
//
// ── IT REFUSES TO UNBIND THE ONLY HOME A NUMBER HAS ────────────────────────
//
// The whole risk is removing the wrong side of the pair - the number would
// then appear nowhere at all, which is strictly worse than a blank tile. So
// for each pair the migration REQUIRES that some OTHER occurrence still binds
// the same field, and refuses otherwise. It also refuses to touch a module
// placed more than once, since unbinding there would silently change every
// other placement.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

export const id = "0305-one-home-per-number";
export const description = "Unbind four tracker tiles from display fields another tile owns, so each number has one home.";
export const touches = ["fields", "modules", "occurrences"];

const PAIRS = [
  ["Fitness Stats", "Daily Steps"],
  ["Liquid Intake", "Daily Water"],
  ["Reading Stats", "Pages Read"],
  ["Workout Log", "Total Workouts"],
];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label;

  const placements = {};
  for (const o of occs) if (o.moduleId) placements[o.moduleId] = (placements[o.moduleId] || 0) + 1;

  let removed = 0;
  for (const [tileLabel, fieldName] of PAIRS) {
    const fs = fields.filter((f) => f.name === fieldName);
    if (fs.length !== 1) throw new Error(`field "${fieldName}": ${fs.length} matches - refusing`);
    const field = fs[0];

    const tiles = occs.filter((o) => labelOf(o) === tileLabel);
    if (tiles.length !== 1) throw new Error(`tile "${tileLabel}": ${tiles.length} occurrences - refusing`);
    const tile = tiles[0];
    const mod = modById[tile.moduleId];
    if (!mod) throw new Error(`tile "${tileLabel}" has no module - refusing`);

    const bindings = Array.isArray(mod.fieldBindings) ? mod.fieldBindings : [];
    const idx = bindings.findIndex((b) => b?.fieldId === field.id);
    if (idx === -1) { log(`  ${tileLabel} :: ${fieldName}: not bound - already done`); continue; }

    // A module placed twice is shared; unbinding would change the other
    // placement too, silently.
    if ((placements[mod.id] || 0) > 1)
      throw new Error(`"${tileLabel}" module is placed ${placements[mod.id]} times - refusing`);

    // THE GUARD THAT MATTERS: the number must still have a home.
    const others = occs.filter((o) => o.id !== tile.id
      && (modById[o.moduleId]?.fieldBindings || []).some((b) => b?.fieldId === field.id));
    if (!others.length)
      throw new Error(`"${fieldName}" is bound ONLY by "${tileLabel}" - unbinding would remove the number entirely; refusing`);

    log(`  ${tileLabel} :: ${fieldName}: unbinding (still bound by ${others.map(labelOf).join(", ")})`);
    removed++;
    if (apply) {
      await Module.updateOne({ id: mod.id, gridId: gid },
        { $set: { fieldBindings: bindings.filter((_, i) => i !== idx) } });
      // A stored value with no binding renders nowhere and would keep the
      // tile in the "bound but unwritten" audit forever if re-bound later.
      if (tile.fields?.[field.id] !== undefined) {
        await Occurrence.updateOne({ id: tile.id, gridId: gid }, { $unset: { [`fields.${field.id}`]: "" } });
      }
    }
  }

  log(`  ${removed} binding(s) ${apply ? "removed" : "would be removed"}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
