/**
 * 0157 — the prescription reads TODAY'S COLUMN, and comes off the bench.
 *
 * `0150` parked the op because it wrote nothing; `0151` un-parked it once the
 * `INIT_VAR` bug was found; `d7e31b74` parked it AGAIN on 2026-08-20, when the
 * tile came up with slots 1-3 blank and 4-6 holding Pull-day movements — a
 * partial, stale list, which is the worst thing a dashboard tile can be.
 *
 * THAT SHAPE IS NOT SOMETHING THIS OP CAN PRODUCE, and measuring is what says so.
 * The pipeline clears all six slots and then writes slot `$n` per match, in
 * order, so its possible outputs are: six values, a PREFIX of the day's list, or
 * six blanks. `1-3 blank, 4-6 filled` is none of those — it requires the six
 * CLEARS to be applied and then abandoned partway, which is exactly what
 * `bindSocketToStore` did until `6b6a5d1d` **the same morning**: one throwing
 * effect silently discarded every effect after it. The parked diagnosis
 * ("it was matching template rows") is therefore RETRACTED: the op's writes
 * were fine and the effect loop dropped half of them.
 *
 * Driven through the real executor over a fresh export of the live grid, four
 * worlds, each one a thing that has actually happened on this grid:
 *
 *     today, as it stands            6 slots, the Pull day, correct
 *     rows not placed yet            6 CLEARS, tile blank — no stale value survives
 *     only 3 of 6 rows placed        slots 1-3, then blanks — a prefix, never stale
 *     one exercise ticked            that slot alone flips to "done"
 *
 * SO THE SCOPE IS THE ONLY THING THAT CHANGES HERE, and the plan called it:
 * *"the column is the fact, the date stamp is a by-product that may not be
 * applied yet."* The loop scoped by the SCHEDULE PAGE plus the row's own DATE;
 * it scopes by `HAS_ANCESTOR $colId` only now — the column the FIND above it
 * already resolves. Both were measured, and they agree on the healthy case,
 * which is the control that makes the difference meaningful:
 *
 *     rows on the column, DATED      page+date 6 · column 6      ← agree
 *     rows on the column, UNDATED    page+date 0 · column 6      ← the failure it fixes
 *     no column for today at all     page+date 6 · column 0      ← fails CLOSED
 *
 * The second line is the rollover: `Place Cycle Day` puts the rows on the column
 * and the date stamp is a separate write. The third is the one that makes this
 * safer rather than merely different — with no column there is no day, and six
 * blanks is the honest answer.
 *
 * **The plan's open question is closed by the first line:** `HAS_ANCESTOR $colId`
 * DOES fire. It reported nothing on 2026-08-19 because the column was truncated
 * by a pm2 restart mid-build, so there was nothing under it to find — the same
 * restart that produced the half-built schedule documented in CLAUDE.md.
 *
 * Idempotent: it rewrites the rules only if they are not already the column
 * form, and refuses out loud if the pipeline is not the shape it expects rather
 * than writing a predicate into a step it did not recognise.
 */
export const id = "0157-prescription-reads-the-column";
export const describe = "Scope the prescription loop to today's column, re-bind the six Workout fields, and re-enable the op.";

const GOAL_TILE = "kg860us2nhc";
const OP_NAME = "Fitness: Today's Prescription";
const NAMES = ["Workout 1", "Workout 2", "Workout 3", "Workout 4", "Workout 5", "Workout 6"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);

  const tile = occs.find(o => o.id === GOAL_TILE);
  if (!tile) { log(`  REFUSING: no Workout Goals tile ${GOAL_TILE} on this grid`); return; }
  const mod = mods.find(m => m.id === tile.moduleId);
  const wf = NAMES.map(n => fields.find(f => f.name === n)).filter(Boolean);
  if (wf.length !== NAMES.length) { log(`  REFUSING: expected ${NAMES.length} Workout fields, found ${wf.length} — run 0149 first`); return; }
  const op = ops.find(o => o.name === OP_NAME);
  if (!op) { log(`  REFUSING: "${OP_NAME}" is not on this grid — run 0149 first`); return; }

  // ---- the loop's scope rules, located STRUCTURALLY -----------------------
  const steps = structuredClone(op.pipeline?.steps || []);
  const loop = steps.find(s => s.type === "loop");
  const gate = loop?.body?.find(s => s.type === "if");
  if (!loop || !gate?.condition?.rules?.length) {
    log("  REFUSING: the pipeline has no loop with a leading IF — its shape has changed"); return;
  }
  const rules = gate.condition.rules;
  const isColScope = rules.some(r => r.comparator === "HAS_ANCESTOR" && r.right === "$colId");
  const keep = rules.filter(r => r.comparator !== "HAS_ANCESTOR" && r.comparator !== "SAME_DAY");
  if (keep.length !== rules.length - (isColScope ? 1 : 2)) {
    log(`  REFUSING: expected one ancestor rule + one date rule, found ${rules.length - keep.length} to replace`); return;
  }
  if (!isColScope) {
    gate.condition.rules = [
      { id: Math.random().toString(36).slice(2, 14), left: "$ex._ancestors", comparator: "HAS_ANCESTOR", right: "$colId" },
      ...keep,
    ];
  }

  const bound = new Set((mod.fieldBindings || []).map(b => b.fieldId));
  const add = wf.filter(f => !bound.has(f.id));
  const toEnable = op.enabled === false;
  log(`  scope: ${isColScope ? "already the column" : "page+date -> HAS_ANCESTOR $colId"}`);
  log(`  bindings to add: ${add.length} · op: ${toEnable ? "to enable" : "already enabled"}`);
  if (isColScope && !add.length && !toEnable) { log("  already converged"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  if (!isColScope) {
    await Operation.updateOne({ id: op.id, gridId }, { $set: { "pipeline.steps": steps } });
    log("  loop rescoped to today's column");
  }
  if (add.length) {
    let order = (mod.fieldBindings || []).length;
    await Module.updateOne({ id: mod.id, gridId }, { $push: { fieldBindings: {
      $each: add.map(f => ({ fieldId: f.id, order: order++, role: "display" })) } } });
    log(`  bound ${add.length} field(s) to "${mod.label}"`);
  }
  if (toEnable) { await Operation.updateOne({ id: op.id, gridId }, { $set: { enabled: true } }); log("  op enabled"); }
  log("  done — RESTART pm2 and reload; the op writes on load.");
}
