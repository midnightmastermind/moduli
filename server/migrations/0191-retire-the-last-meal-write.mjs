/**
 * 0191 — `Meal History` stops computing `Last Meal`, which nothing reads.
 *
 * `0190` unbound `Last Meal` from the `Meal Log` tile on the user's instruction (*"also remove Last
 * Meal from the meal log as well"*) and said, in its own closing section, what that left behind:
 *
 *     After this, **`Last Meal` is bound by nothing** while `Meal History` still computes it — a
 *     write with no reader, which is the inert class from the other direction.
 *
 * Measured before writing anything: **0 modules bind the field** and exactly **one occurrence** still
 * carries a value — `Meal Log` itself, holding the string `"Eat"`, the residue of the binding `0190`
 * removed. So the op runs a loop, tracks a variable and performs an UPDATE every load, and the value
 * lands on a tile that has no pill to render it.
 *
 * ── WHY THE WHOLE VARIABLE GOES, NOT JUST THE UPDATE ────────────────────────────────────────
 *
 * `$lastM` has exactly three sites in the pipeline, and a walk of every branch found all of them:
 *
 *     steps[7]                  INIT_VAR   $lastM = ""
 *     steps[8].body[0].then[1]  SET_VAR    $lastM = $inst.label      (inside the row loop)
 *     steps[10]                 UPDATE     $goalItem.fields.<Last Meal>.value = $lastM
 *
 * Removing only the UPDATE would leave a variable computed on every iteration of the loop and read
 * by nobody — the same defect one layer down, and the shape somebody re-wires six weeks later
 * because it looks like it must have been for something. The removal is keyed on the VARIABLE NAME,
 * so it cannot half-apply: if the three sites are not all found, it refuses.
 *
 * ── WHAT IS DELIBERATELY NOT DONE ───────────────────────────────────────────────────────────
 *
 * **The FIELD is not deleted.** It is one binding away from being useful, deleting a field is
 * destructive, and the queue already carries a separate decision (item 2) about the 15 fields that
 * are bound by nothing, valued by nothing and named in no operation. `Last Meal` joins that list
 * once its stale value is cleared, which is the honest outcome: it becomes visible to `checkGrid`'s
 * own `unused-field` warning rather than being quietly swept here.
 *
 * **`Meals` is untouched.** The same op writes the row array onto the same tile and that one IS
 * bound and IS rendered — the discriminator is the binding, not the op.
 */
export const id = "0191-retire-the-last-meal-write";
export const describe =
  "Remove the `Last Meal` variable and its UPDATE from `Meal History` — 0 modules bind the field — and clear the one stale value it left. Deletes no field.";

/**
 * Strip every step that reads or writes `varName` from a pipeline, at any depth.
 * Returns { pipeline, removed } — `removed` lists `type` per removed step so the
 * caller can check it found the whole set rather than part of it.
 */
export function stripVar(pipeline, varName) {
  const removed = [];
  // BOUNDARY-MATCHED, not a substring. `$last` is a prefix of `$lastM`, so a
  // plain `includes` would take both and silently delete work — the same trap
  // the `noDomainKnowledge` guard hit in 2026-08-06 (3), where `\b` failed to
  // fire inside an identifier. A variable name ends where a non-word character
  // begins.
  const re = new RegExp(`\\${varName}(?![A-Za-z0-9_])`);
  const mentions = (cfg) => re.test(JSON.stringify(cfg || {}));
  const walk = (steps) => (steps || []).filter((s) => {
    const c = s?.config || {};
    // A step that MENTIONS the variable goes — but only when that is all it
    // does. A branch/loop whose own config is clean is kept and descended into,
    // or removing a read would take the loop body with it.
    if (mentions(c)) { removed.push(c.type || "?"); return false; }
    if (s.then) s.then = walk(s.then);
    if (s.else) s.else = walk(s.else);
    if (s.body) s.body = walk(s.body);
    return true;
  });
  const next = JSON.parse(JSON.stringify(pipeline || {}));
  next.steps = walk(next.steps);
  return { pipeline: next, removed };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const LAST = fields.find((f) => f.name === "Last Meal")?.id;
  if (!LAST) { log("  nothing to do — no `Last Meal` field"); return; }

  // THE GUARD: this only retires a write nobody reads. A module binding it
  // again makes the write live, and the migration must not fire then.
  const binders = mods.filter((m) => (m.fieldBindings || []).some((b) => b.fieldId === LAST));
  if (binders.length) {
    log(`  REFUSING: ${binders.length} module(s) bind \`Last Meal\` — the write has a reader: ${binders.map((m) => m.label).join(", ")}`);
    return;
  }
  log("  `Last Meal` is bound by 0 modules — the write has no reader");

  const op = ops.find((o) => JSON.stringify(o.pipeline || {}).includes(`.fields.${LAST}.value`));
  if (!op) { log("  nothing to do — no operation writes it (already retired?)"); return; }

  const { pipeline, removed } = stripVar(op.pipeline, "$lastM");
  if (removed.length < 3) {
    log(`  REFUSING: expected the INIT_VAR + SET_VAR + UPDATE trio, found ${removed.length} (${removed.join(", ")})`);
    return;
  }
  if (JSON.stringify(pipeline).includes(`.fields.${LAST}.value`)) {
    log("  REFUSING: a write to `Last Meal` survives the strip — a second site this did not model");
    return;
  }
  log(`  ${op.name}: removing ${removed.length} step(s) — ${removed.join(", ")}`);

  const stale = occs.filter((o) => o.fields?.[LAST] !== undefined);
  for (const o of stale) log(`  clearing the stale value on ${o.label ?? o.id}: ${JSON.stringify(o.fields[LAST]?.value)}`);

  if (dryRun) { log("  (dry run — nothing written)"); return; }
  await Operation.updateOne({ id: op.id, gridId }, { $set: { pipeline } });
  for (const o of stale) {
    await Occurrence.updateOne({ id: o.id, gridId }, { $unset: { [`fields.${LAST}`]: "" } });
  }
  log(`  done — op updated, ${stale.length} stale value(s) cleared. \`Last Meal\` now shows in checkGrid's unused-field warning.`);
}
