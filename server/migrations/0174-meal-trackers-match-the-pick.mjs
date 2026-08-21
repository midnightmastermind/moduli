/**
 * 0174 — the two meal trackers matched things no meal row has, and both read 0.
 *
 * USER: *"the macros for meals arent working"* / *"when it comes to updating the macro tracker"*.
 * The per-row numbers were fine all along — today's eight meals each carry their own macros
 * (305/23/35/7 …). What is broken is the two TILES, and they are broken for two DIFFERENT reasons
 * that happen to produce the same 0.
 *
 * ── `Meal Nutrition` — matched a MODULE that no placed meal carries ────────────────────────────
 *
 *     LOOP $allInstances … IF $item.templateId IS 4yMvZXwL6MWS      <- the canonical `Eat` module
 *
 * A row placed by `APPLY_TEMPLATE` is a CLONE, and `clone()` mints a NEW module per clone. Measured
 * on today's column:
 *
 *     rows labelled "Eat"          8, sharing 8 DISTINCT modules — not one of them `4yMvZXwL6MWS`
 *     occurrences of 4yMvZXwL6MWS  1 — the catalog row under Routines > Nutrition, off the Schedule
 *
 * So the tracker's FIRST rule excluded every meal on the grid. It has been structurally dead since
 * the meals moved onto template-cloned rows.
 *
 * **AND THE SAME PROBE SAYS THE CLASS IS NARROW, which is the part worth trusting.** Every other
 * routine on the column — Drink, Hygiene, Hot Tub, Walk, Journal, Run, Stretch — shares exactly ONE
 * module, because `Build Schedule` places those by COPY_LINK, which REUSES the module. Only the
 * APPLY_TEMPLATE path mints modules, and only the weekday templates use it. `Completed Habits`
 * reading 1 is the control that says the completion machinery itself is fine.
 *
 * ── `Meal History` — matched a field that does not exist in practice ──────────────────────────
 *
 *     IF $inst.fields.tIOognuArakd.value IS_NOT_EMPTY               <- "Meal Type"
 *
 *     occurrences carrying a Meal Type value   0
 *     modules binding Meal Type                0        <- it is on the `unused-field` warning list
 *
 * A different mistake with the same symptom: this one never worked at all, on any day.
 *
 * ── BOTH BECOME THE SAME STRUCTURAL TEST ─────────────────────────────────────────────────────
 *
 *     $item.fields.<Meal>.value IS_NOT_EMPTY            85 occurrences · 79 modules bind it
 *
 * **A row carrying a Meal pick IS a meal.** It survives cloning (the pick is a field VALUE, copied
 * with the row), it survives a rename (unlike matching the module label "Eat"), and it is the shape
 * this grid already uses elsewhere — `0109` decides "is this a real placement" by asking whether the
 * row carries a Meal or Movement pick, and `Total Workouts` gates on `muscleGroup IS_NOT_EMPTY`.
 * Matching a module id is the thing that could not survive the schedule being rebuilt from templates.
 *
 * ── WHAT IS DELIBERATELY NOT CHANGED ─────────────────────────────────────────────────────────
 *
 * The `Completed IS true` gate STAYS. Asked directly, the user chose ticked-only over counting
 * planned meals — it is the grid-wide rule (*"an item moves trackers/goals only when IN THE SCHEDULE
 * and COMPLETE"*), and `Meal Nutrition` is not the tracker to make an exception of. So the tile
 * still reads what you have eaten, not what you plan to.
 *
 * ── THE RULE IS FOUND STRUCTURALLY, never by step index ──────────────────────────────────────
 *
 * Both edits locate the offending rule by what it TESTS (a `templateId IS` whose right-hand module
 * has no placed occurrences · a rule naming the dead Meal Type field) rather than by position, so a
 * later edit to either pipeline cannot make this migration patch the wrong line. It REFUSES rather
 * than guessing when it cannot find one.
 */
const uid = () => Math.random().toString(36).slice(2, 14);

export const id = "0174-meal-trackers-match-the-pick";
export const describe =
  "Meal Nutrition and Meal History match a Meal PICK instead of a module id / a dead field — both read 0.";

/**
 * Replace a rule inside a pipeline, located by predicate. Returns how many it
 * changed. Exported so the test drives the same walk the migration performs.
 */
export function replaceRule(pipeline, matches, make) {
  let n = 0;
  const visitGroup = (g, loopVar) => {
    if (!g || !Array.isArray(g.rules)) return;
    for (let i = 0; i < g.rules.length; i++) {
      const r = g.rules[i];
      if (r && Array.isArray(r.rules)) { visitGroup(r, loopVar); continue; }
      if (matches(r, loopVar)) { g.rules[i] = make(r, loopVar); n++; }
    }
  };
  const visit = (steps, loopVar) => {
    for (const s of steps || []) {
      if (s.type === "loop") {
        for (const b of s.body || []) if (b?.type === "if") visitGroup(b.condition, s.as);
        visit(s.body, s.as);
      } else {
        if (s.type === "if") visitGroup(s.condition, loopVar);
        if (s.config?.predicate) visitGroup(s.config.predicate, loopVar);
        visit(s.then, loopVar); visit(s.else, loopVar); visit(s.body, loopVar);
      }
    }
  };
  visit(pipeline?.steps, null);
  return n;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const MEAL = fields.find((f) => f.name === "Meal" && f.type === "occurrence" && !f.displayEnabled)?.id;
  const MEAL_TYPE = fields.find((f) => f.name === "Meal Type")?.id;
  if (!MEAL) { log('  REFUSING: no occurrence-typed "Meal" field to match on'); return; }

  const modCount = {};
  for (const o of occs) modCount[o.moduleId] = (modCount[o.moduleId] || 0) + 1;
  const carriers = occs.filter((o) => {
    const v = o.fields?.[MEAL]?.value;
    return v != null && v !== "" && !(Array.isArray(v) && !v.length);
  }).length;
  log(`  "Meal" = ${MEAL} · ${carriers} occurrence(s) carry a pick · ${mods.filter((m) => (m.fieldBindings || []).some((b) => b.fieldId === MEAL)).length} module(s) bind it`);

  const newRule = (loopVar) => ({
    id: uid(), left: `${loopVar || "$item"}.fields.${MEAL}.value`,
    comparator: "IS_NOT_EMPTY", right: "",
  });

  const plan = [];

  // ── Meal Nutrition: a templateId whose module has no PLACED occurrence ────
  const nut = ops.find((o) => o.name === "Meal Nutrition");
  if (nut) {
    const pipe = JSON.parse(JSON.stringify(nut.pipeline));
    const n = replaceRule(pipe,
      (r, loopVar) => {
        if (!r || r.comparator !== "IS") return false;
        if (r.left !== `${loopVar || "$item"}.templateId`) return false;
        // Only a module nothing on the grid actually places. A live one is a
        // working rule and must not be rewritten.
        return (modCount[r.right] || 0) <= 1;
      },
      (r, loopVar) => {
        log(`    Meal Nutrition: templateId IS ${r.right} (${mods.find((m) => m.id === r.right)?.label || "?"}, ${modCount[r.right] || 0} occurrence(s)) -> Meal IS_NOT_EMPTY`);
        return newRule(loopVar);
      });
    if (n) plan.push({ op: nut, pipe, n }); else log("    Meal Nutrition: no dead templateId rule found — already patched, or its shape changed");
  } else log('  no "Meal Nutrition" op on this grid');

  // ── Meal History: the dead Meal Type field ───────────────────────────────
  const hist = ops.find((o) => o.name === "Meal History");
  if (hist && MEAL_TYPE) {
    const pipe = JSON.parse(JSON.stringify(hist.pipeline));
    const n = replaceRule(pipe,
      (r, loopVar) => r && r.left === `${loopVar || "$inst"}.fields.${MEAL_TYPE}.value`,
      (r, loopVar) => {
        log(`    Meal History: ${r.left} ${r.comparator} -> Meal IS_NOT_EMPTY`);
        return newRule(loopVar);
      });
    if (n) plan.push({ op: hist, pipe, n }); else log("    Meal History: no Meal Type rule found — already patched");
  } else if (hist) log('  "Meal Type" field is gone — Meal History left alone');

  if (!plan.length) { log("  nothing to do"); return; }
  if (dryRun) { log(`  (dry run — ${plan.length} op(s) would change)`); return; }
  for (const p of plan) await Operation.updateOne({ _id: p.op._id }, { $set: { pipeline: p.pipe } });
  log(`  patched ${plan.length} op(s) — RESTART pm2 and reload.`);
}
