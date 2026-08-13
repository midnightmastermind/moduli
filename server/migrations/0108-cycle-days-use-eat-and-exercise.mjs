// server/migrations/0108-cycle-days-use-eat-and-exercise.mjs
//
// User, 2026-08-13: "the template must use eat and excercise with the correct
// things filled. not new occurances. i want to make sure thats the case. and
// also move hygeine to the timeslot after the workouts" … "put a hot tub
// routine in under physical as well" … "and add that to schedule in the same
// timeslot as hygeine."
//
// THE USER IS RIGHT AND IT IS A FUNCTIONAL DEFECT, not a naming preference.
// `0104`/`0106` placed COPIES OF THE BOARD ROWS — a row literally labelled
// "Barbell Bench Press" — beside the routines. Measured, that row is invisible
// to the things that are supposed to read it:
//   - `Exercise` is the action that binds **Movement · Set 1-3 · Weight 1-3**,
//     and the workout trackers resolve the MOVEMENT PICK to read its muscle
//     group (2026-07-25). A bare board copy is not an Exercise, so per-muscle
//     Volume and Workout History never see it.
//   - `Eat` is the action that binds **Meal · Ingredient · Calories/Protein/
//     Carbs/Fats**, and `Meal Nutrition` is Eat-scoped. A bare "Greek Yogurt
//     Bowl" row feeds no macro tracker.
// A board row is the OPTION you pick; the routine is the thing you do. The
// schedule holds the doing.
//
// **0 occurrences on this grid carried a Movement or Meal pick before this
// migration** — so nothing existed to pattern-match against and the row shape
// is derived from the two actions' own `fieldBindings`.
//
// THE PICKS ARRIVE FILLED, the way they would if you had picked them by hand:
//   Exercise -> Movement = [the movement], Set 1/2/3 copied FROM the movement
//   Eat      -> Meal = the meal, Ingredient = the meal's own ingredient list,
//               and the four macros SUMMED over those ingredients — which is
//               exactly what `0042`'s prefill chain (Meal -> Ingredient ->
//               macros, combine "sum") produces on a hand pick.
//
// ONE RULE, BOTH DESTINATIONS. `applyCycleDay` runs over the four templates AND
// today's live column. Writing it twice is how a migrated grid and a rebuilt
// day drift; this repo has paid for that more than once.
//
// HYGIENE MOVES 7:00am -> 7:30am — "the timeslot after the workouts", read
// literally: the workout sits in 7:00am and the next slot is 7:30am. HOT TUB
// joins it there, per "the same timeslot as hygeine".
//
// NOTHING THE USER ENTERED IS REMOVED. A board copy is deleted only when it
// carries no value beyond the two stamps the builder writes and has no
// children — the `0106` guard, reused. Anything else is reported and kept.
import { randomUUID } from "node:crypto";
import { MEALS_BY_SLOT, CYCLE } from "./0104-four-day-cycle-templates.mjs";

export const id = "0108-cycle-days-use-eat-and-exercise";
export const describe =
  "Cycle days are Eat / Exercise rows with the Meal and Movement picks filled — not board copies.";

export const WORKOUT_SLOT = "7:00am";
export const HYGIENE_FROM = "7:00am";
export const HYGIENE_TO = "7:30am";
export const ALSO_AT_HYGIENE = ["Hot Tub"];
export const TODAY_COLUMN_DATE = "2026-08-13";
export const TODAY_CYCLE = 1;

const norm = (s) => String(s ?? "").trim().toLowerCase();

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  // Resolved by name AND by being the INPUT field — this grid carries display
  // twins of every macro, and a day's total written onto a meal row is the
  // 0042 trap exactly.
  const fid = (name) => fields.find((f) => f.name === name && !f.displayEnabled)?.id;
  const TS = fid("Time Slot"), DATE = fid("Date");
  const MOVEMENT = fid("Movement"), MEAL = fid("Meal"), INGREDIENT = fid("Ingredient");
  const SETS = ["Set 1", "Set 2", "Set 3"].map(fid);
  const MACROS = ["Calories", "Protein", "Carbs", "Fats"].map(fid);
  const FMT = fid("Schedule Format");
  for (const [n, v] of [["Time Slot", TS], ["Date", DATE], ["Movement", MOVEMENT],
    ["Meal", MEAL], ["Ingredient", INGREDIENT], ["Schedule Format", FMT]]) {
    if (!v) { log(`REFUSING: no input field "${n}".`); return; }
  }

  // The two actions, resolved through the Routines catalog rather than by a
  // bare label — there are 11 modules called "Eat" on this grid and only one
  // is the catalog action.
  const routines = occs.find((o) => nameOf(o) === "Routines");
  const physical = (routines?.occurrences || []).map((i) => byId.get(i))
    .find((d) => /^physical$/i.test(nameOf(d)));
  const catalog = new Map();
  for (const cid of physical?.occurrences || []) {
    for (const k of (byId.get(cid)?.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
      catalog.set(nameOf(k), k);
    }
  }
  const EAT = catalog.get("Eat"), EXERCISE = catalog.get("Exercise");
  if (!EAT || !EXERCISE) { log(`REFUSING: no Eat / Exercise action under Physical.`); return; }

  // Board rows, by label.
  const board = new Map();
  for (const b of ["Meals", "Movements"]) {
    const root = occs.find((o) => nameOf(o) === b);
    for (const cid of root?.occurrences || []) {
      const c = byId.get(cid);
      if (c) board.set(norm(nameOf(c)), c);
    }
  }
  const boardLabels = new Set(board.keys());
  const num = (o, f) => { const v = o?.fields?.[f]?.value; const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // Macros for a meal = sum over its ingredients. Same shape as 0042's chain.
  const macrosForMeal = (meal) => {
    const ing = meal?.fields?.[INGREDIENT]?.value;
    const list = Array.isArray(ing) ? ing : ing ? [ing] : [];
    const out = {};
    MACROS.forEach((mf, i) => {
      if (!mf) return;
      const total = list.reduce((a, id2) => a + num(byId.get(id2), mf), 0);
      if (total) out[mf] = { value: Math.round(total * 10) / 10, flow: "in" };
      void i;
    });
    return { list, macros: out };
  };

  const plan = { adds: [], drops: [], moves: [], kept: [] };

  // ---- the one rule, run over any cycle-day root -------------------------
  const applyCycleDay = (root, cycleN, { stampDate = null, where = "" }) => {
    const cyc = CYCLE.find((c) => c.n === cycleN);
    if (!cyc) return;
    const slots = new Map();
    for (const sid of root.occurrences || []) {
      const s = byId.get(sid);
      const key = s?.fields?.[TS]?.value;
      if (key) slots.set(String(key), s);
    }

    // 1. the board copies 0104/0106 placed come out (guarded)
    for (const [key, s] of slots) {
      for (const kid of (s.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
        if (!boardLabels.has(norm(nameOf(kid)))) continue;
        const own = Object.entries(kid.fields || {}).filter(([f, v]) =>
          f !== TS && f !== DATE && f !== FMT &&
          v?.value !== null && v?.value !== undefined && v?.value !== "" &&
          !(Array.isArray(v.value) && v.value.length === 0));
        // A board copy carries the board's OWN tags; those are not the user's.
        const entered = own.filter(([f]) => ![MOVEMENT, MEAL, INGREDIENT, ...SETS, ...MACROS]
          .includes(f) && f !== fields.find((x) => x.name === "Board Category")?.id &&
          f !== fields.find((x) => x.name === "Muscle Group")?.id);
        if (entered.length || (kid.occurrences || []).length) {
          plan.kept.push({ where, key, label: nameOf(kid), why: `${entered.length} entered value(s)` });
          continue;
        }
        plan.drops.push({ where, key, occ: kid, label: nameOf(kid) });
      }
    }

    const remaining = (s) => (s.occurrences || []).map((i) => byId.get(i)).filter(Boolean)
      .filter((k) => !plan.drops.some((d) => d.occ.id === k.id));

    // 2. Hygiene moves to the slot after the workouts, and Hot Tub joins it
    const from = slots.get(HYGIENE_FROM), to = slots.get(HYGIENE_TO);
    if (from && to) {
      for (const kid of remaining(from)) {
        if (norm(nameOf(kid)) !== "hygiene") continue;
        plan.moves.push({ where, occ: kid, from, to, label: nameOf(kid) });
      }
    }
    if (to) {
      const there = new Set(remaining(to).map((k) => norm(nameOf(k))));
      for (const label of ALSO_AT_HYGIENE) {
        const src = catalog.get(label);
        if (!src) { log(`  REFUSING "${label}" — not a Physical routine`); continue; }
        if (there.has(norm(label))) continue;
        plan.adds.push({ where, key: HYGIENE_TO, slot: to, src, label, extra: {}, stampDate });
      }
    }

    // 3. an Eat row per meal, a filled Exercise row per movement
    const want = [];
    for (const [key, mealLabel] of MEALS_BY_SLOT) {
      const meal = board.get(norm(mealLabel));
      if (!meal) { log(`  REFUSING meal "${mealLabel}" — not on the Meals board`); continue; }
      const { list, macros } = macrosForMeal(meal);
      want.push({ key, src: EAT, label: "Eat", pick: mealLabel, extra: {
        [MEAL]: { value: meal.id, flow: "in" },
        ...(list.length ? { [INGREDIENT]: { value: list, flow: "in" } } : {}),
        ...macros,
      } });
    }
    for (const mv of cyc.movements) {
      const m = board.get(norm(mv));
      if (!m) { log(`  REFUSING movement "${mv}" — not on the Movements board`); continue; }
      const sets = {};
      SETS.forEach((sf) => { if (sf && m.fields?.[sf]?.value != null) sets[sf] = { ...m.fields[sf] }; });
      want.push({ key: WORKOUT_SLOT, src: EXERCISE, label: "Exercise", pick: mv, extra: {
        // Movement is multiSelect — one pick per row, so each movement keeps
        // its own set counts. A single row holding all eight could carry only
        // one set of Set 1/2/3.
        [MOVEMENT]: { value: [m.id], flow: "in" }, ...sets,
      } });
    }
    for (const w of want) {
      const slot = slots.get(w.key);
      if (!slot) { log(`  REFUSING ${w.key} — no such slot in ${where}`); continue; }
      // Idempotent on the PICK, not the label: every meal row is called "Eat".
      const already = remaining(slot).some((k) => {
        const v = k.fields?.[w.src === EAT ? MEAL : MOVEMENT]?.value;
        const ids = Array.isArray(v) ? v : v ? [v] : [];
        return ids.some((id2) => norm(nameOf(byId.get(id2))) === norm(w.pick));
      });
      if (already) continue;
      plan.adds.push({ ...w, slot, where, stampDate });
    }
  };

  // ---- run it over the four templates and today's column ------------------
  const stPage = occs.find((o) => nameOf(o) === "Schedule Template");
  for (const c of CYCLE) {
    const tplMod = mods.find((m) => m.label === `Schedule - Day ${c.n}` && m.meta?.templateModule === true);
    const tpl = tplMod ? occs.find((o) => o.moduleId === tplMod.id) : null;
    if (!tpl) { log(`REFUSING: no template "Schedule - Day ${c.n}".`); continue; }
    void stPage;
    applyCycleDay(tpl, c.n, { stampDate: null, where: `Day ${c.n}` });
  }
  const col = occs.find((o) => o.fields?.[FMT]?.value === "day-col" &&
    String(o.fields?.[DATE]?.value ?? "").slice(0, 10) === TODAY_COLUMN_DATE);
  if (col) applyCycleDay(col, TODAY_CYCLE, { stampDate: TODAY_COLUMN_DATE, where: "today" });
  else log(`note: no day column dated ${TODAY_COLUMN_DATE} — templates only.`);

  // ---- report -------------------------------------------------------------
  const group = (rows, f) => {
    const m = new Map();
    for (const r of rows) m.set(r.where, [...(m.get(r.where) || []), f(r)]);
    return m;
  };
  for (const [w, v] of group(plan.drops, (r) => `${r.key} ${r.label}`)) log(`  - ${w}: ${v.length} board copy(ies) removed`);
  for (const [w, v] of group(plan.moves, (r) => r.label)) log(`  ~ ${w}: ${v.join(", ")} ${HYGIENE_FROM} -> ${HYGIENE_TO}`);
  for (const [w, v] of group(plan.adds, (r) => `${r.label}(${r.pick || r.label})`)) log(`  + ${w}: ${v.length} row(s)  ${v.slice(0, 3).join(", ")}…`);
  for (const k of plan.kept) log(`  KEEPING ${k.where} ${k.key} "${k.label}" — ${k.why}`);
  const sample = plan.adds.find((a) => a.label === "Eat");
  if (sample) log(`  sample Eat "${sample.pick}" -> ${JSON.stringify(Object.fromEntries(
    Object.entries(sample.extra).map(([f, v]) => [fields.find((x) => x.id === f)?.name, v.value])))}`.slice(0, 300));
  const sampleX = plan.adds.find((a) => a.label === "Exercise");
  if (sampleX) log(`  sample Exercise "${sampleX.pick}" -> ${JSON.stringify(Object.fromEntries(
    Object.entries(sampleX.extra).map(([f, v]) => [fields.find((x) => x.id === f)?.name, v.value])))}`.slice(0, 300));

  if (!plan.adds.length && !plan.drops.length && !plan.moves.length) { log(`already correct — no change.`); return; }
  if (dryRun) {
    log(`WOULD add ${plan.adds.length}, remove ${plan.drops.length}, move ${plan.moves.length}.`);
    return;
  }

  // ---- write --------------------------------------------------------------
  for (const d of plan.drops) {
    await Occurrence.updateOne({ gridId, id: d.occ.parentId }, { $pull: { occurrences: d.occ.id } });
    await Occurrence.deleteOne({ gridId, id: d.occ.id });
  }
  for (const mv of plan.moves) {
    await Occurrence.updateOne({ gridId, id: mv.from.id }, { $pull: { occurrences: mv.occ.id } });
    await Occurrence.updateOne({ gridId, id: mv.to.id },
      { $push: { occurrences: mv.occ.id }, $set: { } });
    await Occurrence.updateOne({ gridId, id: mv.occ.id },
      { $set: { parentId: mv.to.id, [`fields.${TS}`]: { value: HYGIENE_TO, flow: "in" } } });
  }
  const perSlot = new Map();
  for (const a of plan.adds) {
    const srcMod = modById.get(a.src.moduleId);
    const nMod = randomUUID(), nOcc = randomUUID();
    await Module.create({
      id: nMod, gridId, userId: a.src.userId, label: a.label,
      role: srcMod?.role || "instance",
      fieldBindings: srcMod?.fieldBindings || [],
      meta: { ...(srcMod?.meta || {}) },
      ownStyle: srcMod?.ownStyle || null,
      styleMode: srcMod?.styleMode || "inherit",
    });
    await Occurrence.create({
      id: nOcc, gridId, userId: a.src.userId, moduleId: nMod, targetId: nMod,
      parentId: a.slot.id, occurrences: [],
      fields: {
        ...(a.src.fields || {}),          // the dimension tag
        ...a.extra,                        // the filled pick
        [TS]: { value: a.key, flow: "in" },
        ...(a.stampDate ? { [DATE]: { value: a.stampDate, flow: "in" } } : {}),
      },
      meta: { appliedFromTemplateId: a.src.id },
    });
    perSlot.set(a.slot.id, [...(perSlot.get(a.slot.id) || []), nOcc]);
  }
  for (const [slotId, ids] of perSlot) {
    await Occurrence.updateOne({ gridId, id: slotId }, { $push: { occurrences: { $each: ids } } });
  }
  log(`added ${plan.adds.length}, removed ${plan.drops.length}, moved ${plan.moves.length}.`);
}
