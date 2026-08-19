/**
 * 0151 — the prescription op works; re-bind its fields and switch it back on.
 *
 * `0150` parked `0149`'s op because it wrote nothing. **It writes now**, and the
 * cause was worth the hunt: `INIT_VAR` assigns `cfg.value` RAW — no `${...}`
 * interpolation, no `literal:` stripping — so `value: "${$n}"` stored the six
 * literal characters `${$n}` and the `$nTxt IS "1"` test below it was false on
 * every iteration. **The same defect fixed in `SET_VAR` this morning, and the
 * one documented on `MULTIPLY_VAR` before that: three sibling cases, one
 * mistake.** The op uses `SET_VAR` for anything that must resolve.
 *
 * FOUR ATTEMPTS WENT INTO THE SCOPE RULES AND NONE OF THEM WAS THE PROBLEM. One
 * measurement settled it — writing `$n` straight after the loop returned **6**,
 * which said the loop had matched all six rows and the fault was downstream.
 * *That measurement cost one run and should have come first; varying a rule you
 * have not measured is guessing with extra steps.*
 *
 * Verified against the grid's own data through the real executor, with the A/B
 * that matters: ticking one exercise flips exactly that slot to "done" and
 * leaves the other five untouched.
 */
export const id = "0151-unpark-the-prescription";
export const describe = "Re-bind the six Workout fields and re-enable the prescription op — it writes now.";

const GOAL_TILE = "kg860us2nhc";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const tile = occs.find(o => o.id === GOAL_TILE);
  if (!tile) { log(`  REFUSING: no Workout Goals tile ${GOAL_TILE}`); return; }
  const mod = mods.find(m => m.id === tile.moduleId);
  const wf = ["Workout 1","Workout 2","Workout 3","Workout 4","Workout 5","Workout 6"]
    .map(n => fields.find(f => f.name === n)).filter(Boolean);
  if (wf.length !== 6) { log(`  REFUSING: expected 6 Workout fields, found ${wf.length}`); return; }

  const bound = new Set((mod.fieldBindings || []).map(b => b.fieldId));
  const add = wf.filter(f => !bound.has(f.id));
  const op = ops.find(o => o.name === "Fitness: Today's Prescription");
  const toEnable = op && op.enabled === false;
  log(`  bindings to add: ${add.length} · op: ${op ? (toEnable ? "to enable" : "already enabled") : "MISSING"}`);
  if (!op) { log("  REFUSING: the op is gone — re-run 0149 first"); return; }
  if (!add.length && !toEnable) { log("  already converged"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  if (add.length) {
    let order = (mod.fieldBindings || []).length;
    await Module.updateOne({ id: mod.id, gridId }, { $push: { fieldBindings: {
      $each: add.map(f => ({ fieldId: f.id, order: order++, role: "display" })) } } });
    log(`  bound ${add.length} field(s) to "${mod.label}"`);
  }
  if (toEnable) { await Operation.updateOne({ id: op.id, gridId }, { $set: { enabled: true } }); log("  op enabled"); }
  log("  done — RESTART pm2 and reload.");
}
