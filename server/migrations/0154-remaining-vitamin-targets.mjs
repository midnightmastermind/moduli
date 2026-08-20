/**
 * 0154 — Vitamin E, K, B6 and Folate get targets and join the tile.
 *
 * USER, 2026-08-20: *"those shouldnt be dropped, look up what the healthy amount
 * is for that for a 33 year old male."*
 *
 * `0153` put eleven nutrients on the Vitamins & Minerals tile — every one
 * `Basic Nutrition Guide.md` gives a daily figure for. Four more already had
 * FIELDS and per-ingredient values from `0123` and were left off, because the
 * guide names no target for them. They are not dropped; they get the standard
 * one.
 *
 * ── WHERE THESE FOUR NUMBERS COME FROM, STATED PLAINLY ──────────────────────
 * **Not from the user's documents** — the guide's table stops at eleven. These
 * are the US Dietary Reference Intakes for an ADULT MALE aged 19-50, which is
 * the band a 33-year-old falls in:
 *
 *     Vitamin E    15 mg      RDA   (alpha-tocopherol)
 *     Vitamin K   120 mcg     AI    (an Adequate Intake, not an RDA — no RDA
 *                                    has been set for vitamin K)
 *     Vitamin B6  1.3 mg      RDA   (rises to 1.7 mg after 50)
 *     Folate      400 mcg     RDA   (dietary folate equivalents)
 *
 * Same provenance line as `0123` and `0152`: public reference figures for a
 * stated population, recorded here rather than presented as if the plan supplied
 * them. **Two are worth knowing about specifically** — vitamin K's number is an
 * Adequate Intake rather than an RDA, and B6's rises with age, so this one is
 * pinned to a 33-year-old and will need revisiting rather than being a constant.
 */
export const id = "0154-remaining-vitamin-targets";
export const describe = "Targets for Vitamin E, K, B6 and Folate (adult male 19-50) and their place on the tile.";

export const TARGETS = { "Vitamin E": 15, "Vitamin K": 120, "Vitamin B6": 1.3, "Folate": 400 };
export const UNITS   = { "Vitamin E": "mg", "Vitamin K": "mcg", "Vitamin B6": "mg", "Folate": "mcg" };

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const names = Object.keys(TARGETS);
  const missingSrc = names.filter(n => !fields.find(f => f.name === n && !f.displayEnabled));
  if (missingSrc.length) { log(`  REFUSING: no source field for ${missingSrc.join(", ")}`); return; }

  const tileMod = mods.find(m => m.label === "Vitamins & Minerals");
  if (!tileMod) { log("  REFUSING: no Vitamins & Minerals tile — 0153 has not run"); return; }
  const tileOcc = occs.find(o => o.moduleId === tileMod.id);
  const op = ops.find(o => o.name === "Nutrition: Today's Micronutrients");
  if (!op) { log("  REFUSING: the micronutrient op is missing"); return; }

  const toCreate = names.filter(n => !fields.find(f => f.name === `Total ${n}` && f.displayEnabled));
  log(`  display fields: ${names.length - toCreate.length} present, ${toCreate.length} to create`);
  names.forEach(n => log(`    ${n.padEnd(12)} target ${TARGETS[n]} ${UNITS[n]}`));
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  const fid = {};
  for (const n of names) {
    const have = fields.find(f => f.name === `Total ${n}` && f.displayEnabled);
    if (have) {
      fid[n] = have.id;
      if (have.displayConfig?.targetValue == null) {
        await Field.updateOne({ id: have.id, gridId }, { $set: { "displayConfig.targetValue": TARGETS[n] } });
      }
      continue;
    }
    const id2 = uid();
    await Field.create({ id: id2, gridId, userId: tileOcc.userId, name: `Total ${n}`, type: "number",
      unit: UNITS[n], inputEnabled: false, displayEnabled: true,
      displayConfig: { targetValue: TARGETS[n] }, meta: {} });
    fid[n] = id2;
  }

  const bound = new Set((tileMod.fieldBindings || []).map(b => b.fieldId));
  const add = names.filter(n => !bound.has(fid[n]));
  if (add.length) {
    let order = (tileMod.fieldBindings || []).length;
    await Module.updateOne({ id: tileMod.id, gridId }, { $push: { fieldBindings: {
      $each: add.map(n => ({ fieldId: fid[n], order: order++, role: "display" })) } } });
    log(`  bound ${add.length} field(s) to the tile`);
  }

  // The op must SUM them too, or the tile gains four pills nothing writes —
  // the empty-promise class `0147` cleared off this very page.
  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  const uidv = (n) => `$${n.replace(/[^A-Za-z0-9]/g, "")}`;
  const A = (config) => ({ id: uid(), type: "action", config });
  const src = (n) => fields.find(f => f.name === n && !f.displayEnabled).id;
  let added = 0;
  // one accumulator per nutrient, beside the existing ones
  const firstLoop = pipeline.steps.findIndex(s => s.type === "loop");
  for (const n of names) {
    if (JSON.stringify(pipeline).includes(uidv(n))) continue;
    pipeline.steps.splice(firstLoop, 0, A({ type: "INIT_VAR", name: uidv(n), value: 0 }));
    added++;
  }
  const loop = pipeline.steps.find(s => s.type === "loop");
  const inner = loop.body[0].then.find(s => s.type === "loop");
  for (const n of names) {
    if (inner.body.some(s => s.config?.name === uidv(n))) continue;
    inner.body.push(A({ type: "ADD_TO_VAR", name: uidv(n), expr: `$ing.fields.${src(n)}.value` }));
  }
  for (const n of names) {
    const path = `$tile.fields.${fid[n]}.value`;
    if (JSON.stringify(pipeline).includes(path)) continue;
    pipeline.steps.push(A({ type: "UPDATE", path, value: uidv(n) }));
  }
  await Operation.updateOne({ id: op.id, gridId }, { $set: { pipeline } });
  log(`  extended the micronutrient op with ${names.length} nutrient(s)`);
}
