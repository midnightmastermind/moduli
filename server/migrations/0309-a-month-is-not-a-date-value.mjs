// "September 2026" was stored in a DATE field.
//
// User, 2026-09-06: *"Tracker date for monthly bills says Invalid Date - 0d
// overdue. should be no overdue. should just say the month."*
//
// The MONTH is what they asked for and it is what the tile computes — the
// mistake is mine, in `0291`, which put that string somewhere it cannot live.
// That migration moved the Monthly Bills tile from `Tracker Scope` (type TEXT,
// which held "Total") onto `Tracker Date` (type DATE) and pointed the op's new
// period loop at it. A month name is not a date value, so every reader of that
// field has been guessing at it:
//
//     Firefox   new Date("September 2026")  ->  Invalid Date   -> "0d overdue"
//     Chrome    new Date("September 2026")  ->  Sept 1         -> "5d overdue"
//
// Two engines, two different wrong answers, and the user is on Firefox — which
// is why the report reads "Invalid Date". Neither is a bug in the renderer's
// arithmetic; both are a field being asked to hold something it is not for.
//
// ── THE FIX IS TO PUT IT BACK WHERE A LABEL LIVES ──────────────────────────
//
// `Tracker Scope` is TEXT and its whole job is to say what a tile's number
// covers — five other tiles carry "Total" in it today. "September 2026" is
// exactly that kind of statement, so the field already existed and 0291 walked
// past it.
//
//   1. the op       the period loop writes Tracker Scope, not Tracker Date
//   2. the binding  the tile displays Tracker Scope again
//   3. the value    the stray "September 2026" is cleared off Tracker Date
//
// (3) is not tidying. Leaving it means the next thing that reads that field —
// a filter, an op, a `DATE_BEFORE` comparison — inherits the same ambiguity,
// and it would read as data the user entered.
//
// The DAILY loop is untouched: a daily tile's Tracker Date is a real
// `YYYY-MM-DD` and belongs in a date field. Only the period loop moves.
//
// Idempotent: converges once the op writes Tracker Scope and the tile binds it.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0309-a-month-is-not-a-date-value";
export const description =
  "The monthly tile says its month in a TEXT field instead of a date field.";
export const touches = ["fields", "modules", "occurrences", "operations"];

/** Walk a pipeline and hand every node to `fn`. */
const walk = (node, fn) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  fn(node);
  Object.values(node).forEach((v) => walk(v, fn));
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const one = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const trackerDate = one("Tracker Date");
  const trackerScope = one("Tracker Scope");

  // The premise, asserted rather than assumed: one field must be able to hold
  // a month name and the other must not. If both are text this migration is
  // solving a problem that no longer exists.
  if (trackerDate.type !== "date" || trackerScope.type !== "text") {
    throw new Error(
      `expected Tracker Date:date + Tracker Scope:text, got ${trackerDate.type}/${trackerScope.type} - refusing`
    );
  }

  // ── 1. the op ────────────────────────────────────────────────────────────
  const op = await Operation.findOne({ gridId: gid, name: "Trackers: Date-Prefix Labels" }).lean();
  if (!op) throw new Error('operation "Trackers: Date-Prefix Labels" not found - refusing');

  const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
  let opWrites = 0;
  walk(pipeline, (n) => {
    // The period loop is identified by WHAT IT WRITES, not by its position:
    // an UPDATE whose value is the month label. The daily loop writes
    // `$activeDate` through the same field and must not be touched.
    const cfg = n.config || n;
    if (
      cfg &&
      typeof cfg.path === "string" &&
      cfg.path.includes(`.fields.${trackerDate.id}.value`) &&
      cfg.value === "$activeMonthLabel"
    ) {
      cfg.path = cfg.path.replace(`.fields.${trackerDate.id}.value`, `.fields.${trackerScope.id}.value`);
      opWrites += 1;
    }
  });
  log(`  op period loop -> Tracker Scope: ${opWrites} step(s)`);

  // ── 2. the bindings + 3. the stray value ─────────────────────────────────
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));

  // A period tile is one declaring `meta.period` — the marker 0291 introduced.
  // Naming the tile would break the moment a second monthly tracker exists.
  const periodTiles = occs.filter((o) => o.meta?.period);
  log(`  period tiles: ${periodTiles.length}`);

  const bindPatches = [];
  const valuePatches = [];
  for (const occ of periodTiles) {
    const mod = modById[occ.moduleId];
    const label = occ.label || mod?.label || occ.id;

    const bindings = (mod?.fieldBindings || []).map((b) => ({ ...b }));
    const dateIdx = bindings.findIndex((b) => b.fieldId === trackerDate.id);
    const hasScope = bindings.some((b) => b.fieldId === trackerScope.id);
    if (dateIdx >= 0 && !hasScope) {
      // Rewrite IN PLACE so the tile's field order is unchanged — binding order
      // is render order, and appending would move the label to the end.
      bindings[dateIdx] = { ...bindings[dateIdx], fieldId: trackerScope.id };
      bindPatches.push({ moduleId: mod.id, label, bindings });
    } else if (dateIdx >= 0 && hasScope) {
      bindings.splice(dateIdx, 1);
      bindPatches.push({ moduleId: mod.id, label, bindings });
    }

    if (occ.fields?.[trackerDate.id] !== undefined) {
      const next = { ...(occ.fields || {}) };
      delete next[trackerDate.id];
      valuePatches.push({ occId: occ.id, label, was: occ.fields[trackerDate.id]?.value, fields: next });
    }
  }

  log(`  rebind Tracker Date -> Tracker Scope: ${bindPatches.length} module(s)`);
  bindPatches.forEach((p) => log(`    ${p.label}`));
  log(`  clear the stray date value: ${valuePatches.length} occurrence(s)`);
  valuePatches.forEach((p) => log(`    ${p.label}: ${JSON.stringify(p.was)}`));

  if (!opWrites && !bindPatches.length && !valuePatches.length) {
    log("  already converged");
    return { ok: true, converged: true };
  }

  if (!apply) {
    log("  DRY RUN - nothing written");
    return { ok: true, dryRun: true, opWrites, rebound: bindPatches.length, cleared: valuePatches.length };
  }

  if (opWrites) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  for (const p of bindPatches) {
    await Module.updateOne({ id: p.moduleId, gridId: gid }, { $set: { fieldBindings: p.bindings } });
  }
  for (const p of valuePatches) {
    await Occurrence.updateOne({ id: p.occId, gridId: gid }, { $set: { fields: p.fields } });
  }

  log(`  APPLIED - op ${opWrites}, rebound ${bindPatches.length}, cleared ${valuePatches.length}`);
  return { ok: true, opWrites, rebound: bindPatches.length, cleared: valuePatches.length };
}
