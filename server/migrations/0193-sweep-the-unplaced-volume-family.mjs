/**
 * 0193 — sweep a display field nothing writes whose only binders are modules that are placed nowhere.
 *
 * USER, on the audit's second finding: **"Sweep them"**.
 *
 * ── WHAT `Total Reps` TURNED OUT TO BE ──────────────────────────────────────────────────────
 *
 * It reads at first like the `0184` class — a field bound by SEVEN modules and written by no
 * operation, i.e. seven tiles rendering an empty pill against a 50/daily target. Measuring the
 * binders is what changed the answer:
 *
 *     Reps · Chest Volume · Back Volume · Legs Volume
 *     Shoulders Volume · Arms Volume · Cardio Volume      -> 0 occurrences EACH
 *
 * Every one of them is placed nowhere, and there is no volume operation on the grid at all. So the
 * per-muscle Volume tracker family (CLAUDE.md 2026-07-25) is unplaced, unwritten and unreachable:
 * nothing renders an empty pill because nothing renders. The field and the seven modules are
 * leftovers, not a broken feature.
 *
 * ── THE PREDICATE IS THE AUDIT'S OWN, so the two cannot drift ───────────────────────────────
 *
 * A field is swept only when ALL of:
 *   - `displayEnabled` — this migration is the display-field audit's outcome and nothing wider;
 *   - no operation names its id, in any of the THREE write forms the audit enumerated
 *     (`fields.<id>.value`, `$display.<id>`, a `targetFieldId`/`fieldId` config key);
 *   - no occurrence carries a value for it, anywhere on the grid;
 *   - it is bound by at least one module — an unbound field is item 2's separate decision, not
 *     this one — and EVERY module binding it has ZERO occurrences.
 *
 * That last clause is the load-bearing one. A single placement means something on the grid renders
 * the tile, and deleting it would remove a surface the user can see. The migration REFUSES rather
 * than partially applying.
 *
 * ── THE MODULES ARE NOT DELETED HERE, AND THE FIRST DRAFT GETTING THAT WRONG IS WHY ─────────
 *
 * The first version deleted the seven binder modules too, guarded by "every field it binds is also
 * being swept". The dry run DECLINED all seven — they also bind `Category` and `Tracker Date`, which
 * survive because OTHER tiles use them. The guard was right to fire and the guard was also the wrong
 * question: shared fields make that clause false for very nearly any tile, so it could almost never
 * delete anything.
 *
 * The right question for a module is the one `sweepOrphans` already asks — is it PLACED, and does
 * anything REFERENCE it — and it asks it with an age floor and a reference scan this migration does
 * not have. Re-deriving "is this module dead" at a second site is a second opinion that drifts from
 * the sweeper's (2026-08-19). So the seven modules are REPORTED here and swept by the tool that owns
 * that decision.
 *
 * The field is deleted here because `sweepOrphans` does not handle fields at all. It is dumped to
 * `backups/orphans/` first, raw, because a restore has to be byte-for-byte what was taken.
 */
import fs from "node:fs";
import path from "node:path";

export const id = "0193-sweep-the-unplaced-volume-family";
export const describe =
  "Delete display fields nothing writes whose every binder has zero occurrences (Total Reps on poms grid). Reports the stranded modules for sweepOrphans rather than re-deriving its predicate. Dumps first.";

/** The three write forms the display-field audit enumerated across all live pipelines. */
export function isWrittenByAnyOp(fieldId, ops) {
  for (const op of ops || []) {
    const J = JSON.stringify(op.pipeline || {});
    if (J.includes(`fields.${fieldId}.value`) || J.includes(`$display.${fieldId}`)) return true;
    let hit = false;
    const visit = (steps) => {
      for (const s of steps || []) {
        const c = s?.config || {};
        if (c.targetFieldId === fieldId || c.fieldId === fieldId) hit = true;
        visit(s.then); visit(s.else); visit(s.body);
      }
    };
    visit(op.pipeline?.steps);
    if (hit) return true;
  }
  return false;
}

/** Returns { fields, stranded, refused } — refused carries a reason per near-miss. */
export function planSweep({ fields, mods, occs, ops }) {
  const placements = new Map();
  for (const o of occs || []) placements.set(o.moduleId, (placements.get(o.moduleId) || 0) + 1);
  const valued = new Set();
  for (const o of occs || []) for (const k of Object.keys(o.fields || {})) valued.add(k);

  const doomedFields = [], refused = [];
  for (const f of fields || []) {
    if (f.displayEnabled !== true) continue;
    if (isWrittenByAnyOp(f.id, ops)) continue;
    const binders = (mods || []).filter((m) => (m.fieldBindings || []).some((b) => b.fieldId === f.id));
    if (!binders.length) continue;                       // unbound: item 2's own decision
    if (valued.has(f.id)) { refused.push({ what: f.name, why: "an occurrence still carries a value" }); continue; }
    const placed = binders.filter((m) => (placements.get(m.id) || 0) > 0);
    if (placed.length) { refused.push({ what: f.name, why: `${placed.length} binder(s) ARE placed: ${placed.map((m) => m.label).join(", ")}` }); continue; }
    doomedFields.push({ id: f.id, name: f.name, binders });
  }

  // The binder modules are REPORTED, never deleted — `sweepOrphans` owns that
  // decision, with an age floor and a reference scan this does not have.
  const stranded = [...new Set(doomedFields.flatMap((f) => f.binders))]
    .filter((m) => (placements.get(m.id) || 0) === 0)
    .map((m) => ({ id: m.id, label: m.label }));
  return { fields: doomedFields, stranded, refused };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const plan = planSweep({ fields, mods, occs, ops });
  for (const r of plan.refused) log(`  DECLINED ${r.what} — ${r.why}`);
  if (!plan.fields.length) { log("  nothing to sweep"); return; }
  log(`  deleting field(s): ${plan.fields.map((f) => f.name).join(", ")}`);
  if (plan.stranded.length) {
    log(`  LEFT FOR sweepOrphans (${plan.stranded.length} unplaced module(s), it owns that predicate): ${plan.stranded.map((m) => m.label).join(", ")}`);
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const dir = path.join(process.cwd(), "backups", "orphans");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dump = {
    migration: id, gridId, at: stamp,
    fields: fields.filter((f) => plan.fields.some((d) => d.id === f.id)),
    // The stranded modules are dumped too even though they are not deleted
    // here: their bindings name the field that IS going, so a restore needs
    // both halves.
    strandedModules: mods.filter((m) => plan.stranded.some((d) => d.id === m.id)),
  };
  const file = path.join(dir, `${stamp}_${id}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  log(`  dumped ${dump.fields.length} field(s) + ${dump.strandedModules.length} stranded module(s) to ${file}`);

  for (const f of plan.fields) await Field.deleteOne({ id: f.id, gridId });
  log(`  done — ${plan.fields.length} field(s) removed; run \`sweepOrphans --apply\` for the modules`);
}
