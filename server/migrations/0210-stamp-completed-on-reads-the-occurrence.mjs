// 0210 — `Schedule: Stamp Completed On` has never written a value.
//
// User, 2026-08-23: *"why is complete in the schedule under tasks, something i
// completed days ago"* — and the answer runs through this op.
//
// The Tasks page's `Completed` container is a FEED whose predicate is
// `Completed IS true OR (Date DATE_BEFORE $today AND Time Slot IS_NOT_EMPTY)`.
// There is **no time window in it at all**, so anything ever ticked stays there
// forever. The field that could give it one — `Completed On` — is bound by 14
// modules and carried a value on **0 occurrences**, because the op that stamps it
// cannot fire.
//
// ── THE GATE READS A KEY THAT DOES NOT EXIST ───────────────────────────────
//
//     IF  $trigger.value  IS  true      ->  stamp Completed On = $today
//     ELSE                              ->  clear it
//
// `$trigger` is a copy of the transaction's own keys (`operationExecutor`), and a
// field change carries **`fields: { <fieldId>: value }`** — there is no `value`
// key on it. So the left side resolves to `undefined`, `undefined IS true` is
// false, and the op has taken its ELSE branch every single time: clearing a field
// that was already empty. It reports a clean run on every tick.
//
// **This is the same mistake I made in my own probe an hour earlier**, which is
// how it was found: a harness built with `fieldId`/`value` reported `RUNS: 0` for
// a working op, and chasing that turned up the real transaction shape.
//
// THE FIX IS ONE RULE: read the value off the OCCURRENCE the trigger already
// resolved. `$occ` is bound in step 1 (`$trigger.occurrence`) and the step below
// already writes through it, so the data is in hand — the gate was simply asking
// the wrong object.
//
// The ELSE is KEPT and is not incidental: un-ticking something should clear its
// completion date, or a corrected tick leaves a date behind that no longer
// describes anything.
//
// SURGICAL. It rewrites the one rule whose `left` is `$trigger.value` inside this
// op and touches nothing else, so a pipeline that has been edited since still
// gets the fix rather than being overwritten.

export const id = "0210-stamp-completed-on-reads-the-occurrence";
export const description =
  "`Schedule: Stamp Completed On` gated on `$trigger.value`, which no transaction carries — it has never stamped anything";

export const OP_NAME = "Schedule: Stamp Completed On";

/**
 * Rewrite the dead gate. PURE and recursive — the rule sits inside a nested IF,
 * and a top-level-only walk would report success having changed nothing (the
 * `0196` failure: an inserted step that the executor silently skipped while
 * fourteen structural tests passed).
 * @returns { steps, patched } — `steps` is null when nothing matched
 */
export function retargetGate(steps, completedFieldId) {
  let patched = 0;
  const walkRules = (group) => {
    if (!group || !Array.isArray(group.rules)) return group;
    return {
      ...group,
      rules: group.rules.map((r) => {
        if (r && Array.isArray(r.rules)) return walkRules(r);       // nested group
        if (r && r.left === "$trigger.value") {
          patched++;
          return { ...r, left: `$occ.fields.${completedFieldId}.value` };
        }
        return r;
      }),
    };
  };
  const walk = (list) => (Array.isArray(list) ? list : []).map((step) => {
    if (!step || step.type !== "if") return step;
    return { ...step, condition: walkRules(step.condition), then: walk(step.then), else: walk(step.else) };
  });
  const next = walk(steps);
  return { steps: patched ? next : null, patched };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field } = models;
  const completed = await Field.findOne({ gridId, name: "Completed", type: "boolean" }).lean();
  if (!completed) { log("  no boolean `Completed` field — REFUSING"); return { patched: 0, refused: true }; }

  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`  no operation named "${OP_NAME}" — nothing to do`); return { patched: 0 }; }

  const { steps, patched } = retargetGate(op.pipeline?.steps, completed.id);
  if (!patched) {
    // Fails LOUD rather than reporting a clean no-op. A migration that quietly
    // finds nothing leaves a pipeline that looks updated and is not.
    log("  no `$trigger.value` rule found — already fixed, or the pipeline changed shape");
    return { patched: 0 };
  }
  log(`  rewriting ${patched} rule(s): $trigger.value -> $occ.fields.${completed.id}.value`);
  if (!dryRun) {
    await Operation.updateOne({ id: op.id, gridId }, { $set: { "pipeline.steps": steps } });
  }
  log(`${dryRun ? "[dry run] " : ""}${patched} gate(s) retargeted`);
  return { patched };
}
