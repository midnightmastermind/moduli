/**
 * 0168 — eight workout tiles retired, and "Workout Goals" becomes the Workout Log.
 *
 * User: *"we dont need a workout log or reps or chest volume goal"* … *"unless i said otherwise,
 * delete them other ones"* … *"change workout goals we currently have, the tile, and change it to
 * workout log"*.
 *
 * WHAT GOES (8 tiles + 7 operations):
 *   Reps                       <- op "Total Reps"
 *   Chest/Back/Legs/Shoulders/Arms/Cardio Volume   <- six ops of the same names
 *   Workout Log (the OLD tile) <- its op is NOT deleted; see below
 *
 * **THE OLD `Workout Log` TILE'S OP IS REPOINTED, NOT DELETED — and that is the whole reason this is
 * one migration rather than two.** `Workout History` is what writes `Workouts` and `Last Workout`,
 * and those are two of the three fields the user asked to KEEP. Deleting the tile and its op together
 * would have left the renamed tile binding two fields nothing writes: present, plausible, and
 * permanently empty. So the op is retargeted at the surviving tile first, and only then is the old
 * one removed.
 *
 * ORDER MATTERS FOR THE NAME, TOO. The rename would collide with the tile it replaces, so the delete
 * happens BEFORE the rename inside a single pass — a half-applied state here is two tiles called
 * "Workout Log", which is exactly the duplicate-name confusion the unique-name rule exists to stop.
 *
 * `Workout 1-6` GO WITH IT. Measured: each is bound by exactly ONE module (Workout Goals) and named
 * by exactly ONE operation (`Fitness: Today's Prescription`), so nothing else can be reading them.
 * The bindings are dropped here; the FIELDS are left in place for `0169`, which replaces the
 * prescription op with the per-movement tile — deleting them now would break that op mid-flight.
 *
 * `Total Workouts` IS DELIBERATELY NOT BOUND HERE, and it is reported rather than silently skipped.
 * The user named it, but the op that computes it targets the `Fitness Stats` tile, which already
 * displays it. Binding it here as well would render an empty pill unless the op is duplicated or
 * retargeted — and retargeting would blank Fitness Stats. That is a product call, not a migration's.
 *
 * EVERYTHING IS DUMPED BEFORE IT IS DELETED. All eight tiles currently read zero or empty, so nothing
 * the user entered is at stake — but "currently reads zero" is a measurement, not a guarantee, and
 * the dump costs nothing.
 */
import fs from "node:fs";
import path from "node:path";

export const id = "0168-consolidate-workout-tiles";
export const describe =
  "Deletes Reps, the six Volume tiles and the old Workout Log (+7 ops), repoints Workout History, and renames Workout Goals to Workout Log.";

const DOOMED = ["Reps", "Chest Volume", "Back Volume", "Legs Volume", "Shoulders Volume", "Arms Volume", "Cardio Volume"];
const TRACKERS_PAGE = "5zaCM_ScvI7n";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation, Field } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean() ]);
  const oById = new Map(occs.map((o) => [o.id, o]));
  const mById = new Map(mods.map((m) => [m.id, m]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;
  const role = (o) => o?.role || mById.get(o?.moduleId)?.role;
  const parentOf = new Map();
  for (const o of occs) for (const c of o.occurrences || []) parentOf.set(c, o.id);
  const underTrackers = (id) => {
    let cur = id, d = 0;
    while (cur && d++ < 30) {
      const p = parentOf.get(cur) ?? oById.get(cur)?.parentId;
      if (!p) return false;
      if (p === TRACKERS_PAGE) return true;
      cur = p;
    }
    return false;
  };
  // STRUCTURAL: an instance tile under the Trackers page with this label. A bare
  // name match would also catch the Movements board's own rows.
  const tile = (name) => occs.find((o) => lbl(o) === name && role(o) === "instance" && underTrackers(o.id));

  const goals = tile("Workout Goals");
  const oldLog = tile("Workout Log");
  if (!goals) { log("  REFUSING: no 'Workout Goals' tile under the Trackers page"); return; }

  const doomed = DOOMED.map((n) => ({ n, o: tile(n) })).filter((x) => x.o);
  const missing = DOOMED.filter((n) => !tile(n));
  log(`  to delete: ${doomed.length} of ${DOOMED.length} named tiles${missing.length ? ` (already gone: ${missing.join(", ")})` : ""}${oldLog ? " + the old Workout Log" : ""}`);

  const ops = await Operation.find({ gridId }).lean();
  const doomedOps = ops.filter((o) => DOOMED.includes(o.name) || o.name === "Total Reps");
  log(`  ops to delete: ${doomedOps.map((o) => o.name).join(", ") || "(none)"}`);

  const history = ops.find((o) => o.name === "Workout History");
  const repoint = history && oldLog && JSON.stringify(history.pipeline || {}).includes(oldLog.id);
  log(`  Workout History: ${repoint ? `repoint ${oldLog.id} -> ${goals.id}` : "nothing to repoint"}`);

  const trackerDate = await Field.findOne({ gridId, name: "Tracker Date" }).lean();
  const goalsMod = mById.get(goals.moduleId);
  const wNums = await Field.find({ gridId, name: { $in: [1,2,3,4,5,6].map((i) => `Workout ${i}`) } }).lean();
  const wIds = new Set(wNums.map((f) => f.id));
  const keptBindings = (goalsMod?.fieldBindings || []).filter((b) => !wIds.has(b.fieldId));
  const hasDate = keptBindings.some((b) => b.fieldId === trackerDate?.id);
  log(`  renamed tile: drop ${(goalsMod?.fieldBindings || []).length - keptBindings.length} Workout N binding(s)` +
      `${trackerDate && !hasDate ? ", add Tracker Date" : ""}`);
  log(`  NOT bound (reported, not skipped silently): Total Workouts — its op targets the Fitness Stats tile, which already shows it.`);

  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // ── dump first ─────────────────────────────────────────────────────────────
  const victims = [...doomed.map((d) => d.o), ...(oldLog ? [oldLog] : [])];
  const dir = path.resolve("backups/orphans");
  fs.mkdirSync(dir, { recursive: true });
  const dump = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_0168-workout-tiles.json`);
  fs.writeFileSync(dump, JSON.stringify({ occurrences: victims, operations: doomedOps }, null, 1));
  log(`  dumped ${victims.length} occurrence(s) + ${doomedOps.length} op(s) to ${dump}`);

  // ── repoint BEFORE deleting, so the fields are never orphaned ──────────────
  if (repoint) {
    const patched = JSON.parse(JSON.stringify(history.pipeline).split(oldLog.id).join(goals.id));
    await Operation.updateOne({ _id: history._id }, { $set: { pipeline: patched } });
    log("  repointed Workout History at the surviving tile");
  }

  // ── delete ─────────────────────────────────────────────────────────────────
  const ids = victims.map((v) => v.id);
  await Occurrence.deleteMany({ gridId, id: { $in: ids } });
  // unlist from whatever parents held them
  await Occurrence.updateMany({ gridId, occurrences: { $in: ids } }, { $pull: { occurrences: { $in: ids } } });
  await Operation.deleteMany({ _id: { $in: doomedOps.map((o) => o._id) } });
  log(`  deleted ${ids.length} tile(s) and ${doomedOps.length} operation(s)`);

  // ── rename + rebind ────────────────────────────────────────────────────────
  const bindings = [...keptBindings];
  if (trackerDate && !hasDate) bindings.push({ fieldId: trackerDate.id, role: "display" });
  await Module.updateOne({ id: goals.moduleId, gridId }, { $set: { label: "Workout Log", fieldBindings: bindings } });
  await Occurrence.updateOne({ id: goals.id, gridId }, { $set: { label: null } });
  log("  renamed 'Workout Goals' -> 'Workout Log' and rebound it");
  log("  done — RESTART pm2 and reload.");
}
