/**
 * 0170 — a goal per SPECIFIC MOVEMENT, on one tile.
 *
 * User: *"we need goals for specific workouts that day"* … *"another tile that has Workouts with a
 * display field for each just seeing if i did it for that day"*, each field **0/1 with a target of
 * 1**, and Run + Stretch included so a cardio-only day is not blank.
 *
 * **THE FIELD SET IS DERIVED FROM THE TEMPLATES, NOT FROM THE CATALOG.** Walking the seven weekday
 * templates for their Movement picks gives **24 distinct movements** — six each on Mon/Tue/Wed/Thu,
 * none on Fri/Sat/Sun — plus `Run` and `Stretch`, which carry NO Movement pick because they are
 * routines rather than catalog movements. 26 fields. The whole Movements board would have been ~30,
 * six of them permanently hidden; scoping to what the templates actually use means every field minted
 * can light up.
 *
 * **IT IS GAP-FILLING, NOT CREATE-ONCE**, and that is deliberate rather than tidy. A movement added to
 * a template later has no field until this runs again — the `0120`/`0130` class, where "every X" means
 * every X that existed WHEN IT RAN. Re-running mints only what is missing, so the remedy is one
 * command. (The user asked for the OPERATION to mint fields itself; the executor has no `CREATE_FIELD`
 * action, and adding one means a pipeline creating SCHEMA on live data — deferred to its own pass and
 * recorded in the plan.)
 *
 * **NAMES ARE CHECKED FOR COLLISION BEFORE ANYTHING IS WRITTEN.** This grid enforces unique field
 * names (2026-07-14, and `0077` renamed five pairs to restore it), and `[Field]` label tokens resolve
 * BY NAME — so a duplicate is not cosmetic, it silently re-points a token. If any movement name is
 * already taken by a field this migration did not create, it REFUSES rather than minting a twin.
 *
 * The tile binds `Tracker Date` like every other tracker, so it reads "Total" when the date filter is
 * cleared (`0167`).
 */
const uid = () => Math.random().toString(36).slice(2, 14);
const TRACKERS_PAGE = "5zaCM_ScvI7n";
const WEEKDAY = "hzkcwybebz", MOVEMENT = "gF1S8FoNc4An";
const ROUTINES = ["Run", "Stretch"];   // carry no Movement pick — matched by label

export const id = "0170-workouts-tile";
export const describe =
  "Mints one 0/1 display field per movement the weekday templates use (+ Run and Stretch) and a 'Workouts' tile binding them.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean() ]);
  const oById = new Map(occs.map((o) => [o.id, o]));
  const mById = new Map(mods.map((m) => [m.id, m]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;

  // ── the movements the templates actually place ────────────────────────────
  const tpls = occs.filter((o) => o.fields?.[WEEKDAY]?.value);
  const names = new Set();
  for (const t of tpls) {
    const walk = (id, d = 0) => {
      if (d > 4) return;
      for (const c of oById.get(id)?.occurrences || []) {
        const o = oById.get(c); if (!o) continue;
        const v = o.fields?.[MOVEMENT]?.value;
        if (v) { const mv = oById.get(Array.isArray(v) ? v[0] : v); if (mv) names.add(String(lbl(mv))); }
        walk(c, d + 1);
      }
    };
    walk(t.id);
  }
  for (const r of ROUTINES) names.add(r);
  const wanted = [...names].sort();
  log(`  weekday templates: ${tpls.length} · movements they place + routines: ${wanted.length}`);
  if (!wanted.length) { log("  REFUSING: no movements found on any weekday template"); return; }

  // ── collision check, before anything is written ───────────────────────────
  const byName = new Map(fields.map((f) => [f.name, f]));
  const mine = (f) => f?.meta?.workoutGoal === true;
  const clashes = wanted.filter((n) => byName.has(n) && !mine(byName.get(n)));
  if (clashes.length) {
    log(`  REFUSING: ${clashes.length} name(s) already taken by a field this migration did not create:`);
    for (const c of clashes) log(`     "${c}" (${byName.get(c).id}) — this grid requires unique field names`);
    return;
  }
  const toMint = wanted.filter((n) => !byName.has(n));
  log(`  fields: ${wanted.length - toMint.length} already exist · ${toMint.length} to mint`);

  const trackerDate = await Field.findOne({ gridId, name: "Tracker Date" }).lean();
  const container = occs.find((o) => String(lbl(o)) === "Today's Workout");
  if (!container) { log("  REFUSING: no 'Today's Workout' container to put the tile in"); return; }
  const existingTile = (container.occurrences || []).map((i) => oById.get(i)).find((o) => String(lbl(o)) === "Workouts");
  log(`  tile: ${existingTile ? `exists (${existingTile.id}) — rebinding` : "to create"} in "${lbl(container)}"`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // ── mint the missing fields ───────────────────────────────────────────────
  const minted = [];
  for (const n of toMint) {
    const f = {
      id: uid(), gridId, userId: container.userId, name: n, type: "number",
      inputEnabled: false, displayEnabled: true,
      // 0/1 with a target of 1 — the user's pick, so a movement reads as met the
      // moment its row is ticked and the tile can total the day.
      displayConfig: { targetValue: 1, targetPeriod: "daily" },
      meta: { workoutGoal: true },   // how a re-run recognises its own work
    };
    await Field.create(f);
    minted.push(f);
  }
  log(`  minted ${minted.length} field(s)`);

  const all = await Field.find({ gridId, name: { $in: wanted } }).lean();
  const bindings = all.sort((a, b) => wanted.indexOf(a.name) - wanted.indexOf(b.name))
    .map((f) => ({ fieldId: f.id, role: "display" }));
  if (trackerDate) bindings.push({ fieldId: trackerDate.id, role: "display" });

  // ── the tile ──────────────────────────────────────────────────────────────
  if (existingTile) {
    await Module.updateOne({ id: existingTile.moduleId, gridId }, { $set: { fieldBindings: bindings } });
    log(`  rebound the existing tile to ${bindings.length} field(s)`);
  } else {
    const modId = uid(), occId = uid();
    await Module.create({ id: modId, gridId, userId: container.userId, label: "Workouts",
      role: "instance", fieldBindings: bindings, meta: { workoutGoalTile: true } });
    await Occurrence.create({ id: occId, gridId, userId: container.userId, moduleId: modId,
      parentId: container.id, role: "instance", fields: {}, occurrences: [] });
    await Occurrence.updateOne({ id: container.id, gridId }, { $push: { occurrences: occId } });
    log(`  created the "Workouts" tile ${occId} binding ${bindings.length} field(s)`);
  }
  log("  done — RESTART pm2 and reload.");
}
