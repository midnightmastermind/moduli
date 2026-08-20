/**
 * 0153 — today's vitamins and minerals, totalled, with the guide's targets.
 *
 * USER, 2026-08-19: *"the nutrition side should be the amount i need in a day"*,
 * *"for cals macros and vitamins"*, *"i want goals to hit each of those"*, and —
 * asked about the seven minerals the guide targets — **track all of them.**
 *
 * MACROS AND MICROS LIVE IN DIFFERENT PLACES, which is why this is a new op
 * rather than four more lines in `Meal Nutrition`. That op sums
 * `$item.fields.<macro>.value` straight off the EAT ROWS, because `0108`
 * prefilled each row's macros from its ingredients. **Micronutrients were never
 * prefilled** — they live on the INGREDIENT rows (`0123`, `0152`) — so reaching
 * them needs a second hop through the row's `Ingredient` picks.
 *
 * A NESTED LOOP OVER AN ID ARRAY IS AN ESTABLISHED PATTERN HERE, not an
 * invention: `Tracker: Phone Calls` loops a row's `People` array and resolves
 * each id through `$allItemsById.${...}`. This does the same with `Ingredient`.
 *
 * WHY NOT PREFILL THE EAT ROWS instead, mirroring `0108`? Because a prefill goes
 * stale the moment a meal's ingredient list changes, and nothing recomputes it —
 * the same reason `0119` had to backfill sets that had been copied before the
 * field existed. Reading through to the ingredients is always current.
 *
 * SCOPE IS COPIED FROM `Meal Nutrition`, deliberately: the same ancestor
 * (`llpF10Bda5nu`), the same `feedSourceId IS_EMPTY`, the same `Completed IS
 * true`, the same period gate. **Two ops that answer "what did I eat today"
 * must not disagree**, and the way to guarantee that is to ask the question the
 * same way rather than to write a second opinion.
 *
 * THE TARGETS ARE QUOTED FROM `Basic Nutrition Guide.md`, never derived, and the
 * low end of a range is used — hitting 600 IU satisfies "600-800", the same rule
 * `0146` applied to the macros.
 */
export const id = "0153-todays-micronutrients";
export const describe = "Total today's vitamins and minerals from the meal's ingredients, against the guide's daily targets.";

const SCHEDULE_PAGE = "llpF10Bda5nu";
const NUTRITION_CONTAINER = "Tx30JDgxPwhU";

// nutrient -> daily target, from Basic Nutrition Guide.md (low end of a range).
export const TARGETS = {
  "Vitamin A": 900, "Vitamin C": 90, "Vitamin D": 600, "Vitamin B12": 2.4,
  "Magnesium": 400, "Iron": 8, "Zinc": 11, "Calcium": 1000,
  "Omega-3": 250, "Sodium": 2300, "Potassium": 3400,
};

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const src = (n) => fields.find(f => f.name === n && !f.displayEnabled);
  const ING = src("Ingredient"), CMP = src("Completed"), MEAL = src("Meal");
  if (!ING || !CMP || !MEAL) { log("  REFUSING: missing Ingredient / Completed / Meal"); return; }
  const names = Object.keys(TARGETS);
  const missingSrc = names.filter(n => !src(n));
  if (missingSrc.length) { log(`  REFUSING: no source field for ${missingSrc.join(", ")}`); return; }
  const container = byId.get(NUTRITION_CONTAINER);
  if (!container) { log("  REFUSING: no Nutrition container"); return; }

  const need = names.map(n => `Total ${n}`).concat(["Meal Count"]);
  const have = new Map(fields.filter(f => need.includes(f.name) && f.displayEnabled).map(f => [f.name, f]));
  log(`  display fields: ${have.size} present, ${need.length - have.size} to create`);
  const tileExists = (container.occurrences || []).map(i => byId.get(i)).filter(Boolean)
    .some(o => mods.find(m => m.id === o.moduleId)?.label === "Vitamins & Minerals");
  log(`  tile "Vitamins & Minerals": ${tileExists ? "already there" : "to create"}`);
  log(`  op "Nutrition: Today's Micronutrients": ${ops.some(o => o.name === "Nutrition: Today's Micronutrients") ? "to replace" : "to create"}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  const fid = {};
  for (const n of need) {
    const h = have.get(n);
    if (h) { fid[n] = h.id; continue; }
    const id2 = uid();
    const nutrient = n.replace(/^Total /, "");
    await Field.create({ id: id2, gridId, userId: container.userId, name: n, type: "number",
      unit: n === "Meal Count" ? "" : (src(nutrient)?.unit || ""),
      inputEnabled: false, displayEnabled: true,
      displayConfig: TARGETS[nutrient] !== undefined ? { targetValue: TARGETS[nutrient] } : {},
      meta: {} });
    fid[n] = id2;
  }
  log(`  fields ready (${need.length})`);
  // A target on an existing field too — a goal is the point of the tile.
  for (const n of names) {
    const f = have.get(`Total ${n}`);
    if (f && f.displayConfig?.targetValue == null) {
      await Field.updateOne({ id: f.id, gridId }, { $set: { "displayConfig.targetValue": TARGETS[n] } });
    }
  }

  // ---- the tile ----------------------------------------------------------
  if (!tileExists) {
    const moduleId = uid(), occId = uid();
    await Module.create({ id: moduleId, gridId, userId: container.userId,
      label: "Vitamins & Minerals", role: "instance",
      fieldBindings: names.map((n, i) => ({ fieldId: fid[`Total ${n}`], order: i, role: "display" })),
      meta: {} });
    await Occurrence.create({ id: occId, gridId, userId: container.userId, moduleId,
      parentId: container.id, fields: {}, occurrences: [] });
    await Occurrence.updateOne({ id: container.id, gridId }, { $push: { occurrences: occId } });
    log(`  created tile "Vitamins & Minerals" occ=${occId}`);
  }
  const tileOcc = (await Occurrence.find({ gridId, parentId: container.id }).lean())
    .find(o => mods.concat([]).find(m => m.id === o.moduleId)?.label === "Vitamins & Minerals")
    || (await Occurrence.find({ gridId, parentId: container.id }).lean()).at(-1);

  // Meal Count goes on the Intake tile, which is where meals already live.
  const intake = mods.find(m => m.label === "Intake" && m.role === "instance");
  if (intake && !(intake.fieldBindings || []).some(b => b.fieldId === fid["Meal Count"])) {
    await Module.updateOne({ id: intake.id, gridId }, { $push: { fieldBindings:
      { fieldId: fid["Meal Count"], order: (intake.fieldBindings || []).length, role: "display" } } });
    log(`  bound "Meal Count" to the Intake tile`);
  }

  // ---- the op ------------------------------------------------------------
  const A = (config) => ({ id: uid(), type: "action", config });
  const rule = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
  // MEAL COUNT IS WRITTEN WHERE IT IS BOUND. The first version wrote it to
  // `$tile` — the Vitamins & Minerals tile — while binding the field to the
  // INTAKE tile, so the value landed on an occurrence nothing renders and Intake
  // showed nothing. A field's value is per-OCCURRENCE; binding it in one place
  // and writing it in another is two halves that never meet.
  const intakeOcc = intake ? occs.find(o => o.moduleId === intake.id) : null;
  if (!intakeOcc) log("  NOTE: no Intake tile occurrence — Meal Count will go to the micronutrient tile");
  const steps = [
    A({ type: "INIT_VAR", name: "$tile", expr: `$allItemsById.${tileOcc.id}` }),
    A({ type: "INIT_VAR", name: "$countTile", expr: `$allItemsById.${(intakeOcc || tileOcc).id}` }),
    A({ type: "INIT_VAR", name: "$meals", value: 0 }),
    ...names.map(n => A({ type: "INIT_VAR", name: `$${n.replace(/[^A-Za-z0-9]/g, "")}`, value: 0 })),
    { id: uid(), type: "loop", overExpr: "$allInstances", as: "$item", body: [
      { id: uid(), type: "if", condition: { operator: "AND", rules: [
        rule("$item._ancestors", "HAS_ANCESTOR", SCHEDULE_PAGE),
        rule("$item.meta.feedSourceId", "IS_EMPTY"),
        rule(`$item.fields.${CMP.id}.value`, "IS", true),
        rule(`$item.fields.${ING.id}.value`, "IS_NOT_EMPTY"),
      ] }, then: [
        A({ type: "INCREMENT_VAR", name: "$meals", by: 1 }),
        // Second hop: the micronutrients are on the INGREDIENTS, not the row.
        { id: uid(), type: "loop", overExpr: `$item.fields.${ING.id}.value`, as: "$ingId", body: [
          A({ type: "INIT_VAR", name: "$ing", expr: "$allItemsById.${$ingId}" }),
          ...names.map(n => A({ type: "ADD_TO_VAR", name: `$${n.replace(/[^A-Za-z0-9]/g, "")}`,
            expr: `$ing.fields.${src(n).id}.value` })),
        ] },
      ], else: [] },
    ] },
    A({ type: "UPDATE", path: `$countTile.fields.${fid["Meal Count"]}.value`, value: "$meals" }),
    ...names.map(n => A({ type: "UPDATE", path: `$tile.fields.${fid[`Total ${n}`]}.value`,
      value: `$${n.replace(/[^A-Za-z0-9]/g, "")}` })),
  ];
  const model = ops.find(o => o.name === "Meal Nutrition");
  await Operation.deleteOne({ gridId, name: "Nutrition: Today's Micronutrients" });
  await Operation.create({ id: uid(), gridId, userId: container.userId,
    name: "Nutrition: Today's Micronutrients", enabled: true,
    triggerTypes: model?.triggerTypes ?? [], triggerObjects: model?.triggerObjects ?? [],
    targetOccurrenceId: model?.targetOccurrenceId ?? null,
    pipeline: { sources: [], steps } });
  log(`  created op with ${steps.length} top-level steps`);
  log("  RESTART pm2 and reload.");
}
