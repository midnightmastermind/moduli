/**
 * 0192 — bind the display fields an operation writes onto a tile that does not render them.
 *
 * USER, 2026-08-20: *"look at all my display fields and make sure they are being used by an
 * operation or updated in some way"*, and on the finding: **"Bind Workout 1-6 on Workout Log"**.
 *
 * ── THE AUDIT THAT PRODUCED THIS, and its own false positive ────────────────────────────────
 *
 * All 99 display-enabled fields were sorted four ways — written by an op, bound by a module,
 * both, neither:
 *
 *     91  healthy              written AND bound
 *      6  WRITTEN, NOT BOUND   Workout 1-6        <- this migration
 *      1  BOUND, NOT WRITTEN   Total Reps         <- 0193
 *      1  neither              Last Meal          <- 0191, deliberately left on the unused list
 *
 * The first pass reported `Days Until Due` as unwritten and it was WRONG: `DATE_DIFF` writes via
 * `targetFieldId`, a form a `fields.<id>.value` match cannot see. Rather than add one more guessed
 * key, every config key holding a field id across all 68 live pipelines was enumerated —
 * `targetFieldId`, `fieldId`, and the path form — and the audit re-run against all three.
 *
 * ── `Fitness: Today's Prescription` COMPUTES SIX MOVEMENTS AND RENDERS NONE ─────────────────
 *
 * It writes `$goalItem.fields.<Workout N>.value` for N=1..6, where `$goalItem` is picker-direct to
 * the `Workout Log` tile — whose module binds `Last Workout · Workouts · Category · Tracker Date`
 * and none of the six. So the op clears and rewrites six values every load onto a tile with no pill
 * for them. That op has a test asserting it WRITES; nothing asserted anything renders it — the
 * "driving the callee proves nothing about the call" rule, from the data side.
 *
 * Third instance of this class today: `0184` retired a tile bound to fields nothing wrote, `0191`
 * retired a write nothing was bound to, and this binds the other half rather than deleting it,
 * because the prescription is wanted.
 *
 * ── THE RULE IS STRUCTURAL AND ITS BLAST RADIUS WAS MEASURED FIRST ──────────────────────────
 *
 * Not "bind the fields called Workout N" — a name is one rename from wrong. The rule is:
 *
 *     an op sets  INIT_VAR $v = $allItemsById.<occ>
 *     and writes  UPDATE   $v.fields.<F>.value
 *     where <occ>'s module does not bind <F>
 *
 * Run over every live pipeline that matches **7** pairs, not 6. The seventh is
 * `Schedule: Place Cycle Day` writing `Cycle Day` onto the `Last Opened` marker — a value STORED to
 * make a rebuild stable (2026-08-13 (2)), never meant to render. Binding it would have put an
 * internal marker on screen.
 *
 * **`Cycle Day` is `displayEnabled: false` and every Workout field is `true`**, so the scope is
 * `displayEnabled === true` — structural, not a name list. A display field exists to be shown; a
 * plain field may legitimately be a stored marker. With that scope the rule matches exactly 6.
 */
export const id = "0192-a-display-field-nothing-renders";
export const describe =
  "Bind the DISPLAY fields an operation writes onto a tile whose module does not bind them (6 on poms grid: Workout 1-6 on Workout Log). Adds bindings only.";

/**
 * Every (tile module, field) pair where an op writes a DISPLAY field onto a
 * picker-direct occurrence whose module does not bind it.
 * Pure, so the predicate that decides a live write is testable on its own.
 */
export function unrenderedWrites({ ops, occs, mods, fields }) {
  const byId = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const fById = new Map(fields.map((f) => [f.id, f]));
  const out = new Map();
  for (const op of ops || []) {
    const vars = new Map();
    const collectVars = (steps) => {
      for (const s of steps || []) {
        const c = s?.config || {};
        if (c.type === "INIT_VAR" && typeof c.expr === "string") {
          const m = /^\$allItemsById\.([A-Za-z0-9_-]+)$/.exec(c.expr);
          if (m) vars.set(c.name, m[1]);
        }
        collectVars(s.then); collectVars(s.else); collectVars(s.body);
      }
    };
    collectVars(op.pipeline?.steps);
    const collectWrites = (steps) => {
      for (const s of steps || []) {
        const c = s?.config || {};
        if (c.type === "UPDATE" && typeof c.path === "string") {
          const m = /^(\$\w+)\.fields\.([A-Za-z0-9_-]+)\.value$/.exec(c.path);
          const occ = m && vars.has(m[1]) ? byId.get(vars.get(m[1])) : null;
          const mod = occ ? modById.get(occ.moduleId) : null;
          const fld = m ? fById.get(m[2]) : null;
          // displayEnabled is the whole scope: a DISPLAY field exists to be
          // shown, so an unbound one is a defect. A plain field written onto a
          // tile may be a deliberate stored marker (`Cycle Day` on `Last
          // Opened`), and binding it would put an internal value on screen.
          if (mod && fld?.displayEnabled === true
              && !(mod.fieldBindings || []).some((b) => b.fieldId === fld.id)) {
            out.set(`${mod.id}::${fld.id}`, { moduleId: mod.id, moduleLabel: mod.label, fieldId: fld.id, fieldName: fld.name, op: op.name });
          }
        }
        collectWrites(s.then); collectWrites(s.else); collectWrites(s.body);
      }
    };
    collectWrites(op.pipeline?.steps);
  }
  return [...out.values()];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const gaps = unrenderedWrites({ ops, occs, mods, fields });
  if (!gaps.length) { log("  nothing to do — every display field an op writes is bound where it lands"); return; }

  const byModule = new Map();
  for (const g of gaps) (byModule.get(g.moduleId) || byModule.set(g.moduleId, []).get(g.moduleId)).push(g);
  const modById = new Map(mods.map((m) => [m.id, m]));

  for (const [mid, list] of byModule) {
    const mod = modById.get(mid);
    log(`  ${mod.label}: + ${list.map((g) => g.fieldName).join(", ")}  (written by ${[...new Set(list.map((g) => g.op))].join(", ")})`);
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const [mid, list] of byModule) {
    const mod = modById.get(mid);
    const existing = mod.fieldBindings || [];
    // Appended after the tile's own bindings, in the order the op writes them,
    // because binding order IS render order (`0117`).
    let order = existing.reduce((n, b) => Math.max(n, b.order ?? 0), -1);
    const added = list
      .filter((g) => !existing.some((b) => b.fieldId === g.fieldId))
      .map((g) => ({ fieldId: g.fieldId, order: ++order, hidden: false, role: "display" }));
    if (!added.length) continue;
    await Module.updateOne({ id: mid, gridId }, { $set: { fieldBindings: [...existing, ...added] } });
  }
  log(`  done — ${gaps.length} binding(s) added across ${byModule.size} tile(s)`);
}
