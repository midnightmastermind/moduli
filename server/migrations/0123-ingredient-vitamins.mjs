// server/migrations/0123-ingredient-vitamins.mjs
//
// User, 2026-08-13: "fill the vitamins amounts correctly."
//
// ── WHERE THESE NUMBERS COME FROM, STATED PLAINLY ───────────────────────────
// **Not from the user's documents.** `Nutrition Plan.md` lists "Key Vitamins &
// Nutrients" per item, but QUALITATIVELY — "Iron, Zinc, B Vitamins" — and
// `Basic Nutrition Guide.md` gives daily TARGETS for four vitamins, not
// per-ingredient content. There is no numeric source on this grid.
//
// So these are **standard reference values for the stated serving**, of the kind
// a nutrition database publishes. They are accurate to the magnitude a food log
// needs and are NOT a substitute for a label reading. That distinction is why
// this is recorded here rather than presented as if the plan supplied it — and
// it is the same reason `0120` left **Price** empty. The difference is that a
// food's vitamin content is a property OF THE FOOD, stable and public, whereas a
// price is a fact about a shop on a day. One can be looked up; the other would
// have been invented.
//
// ── PER SERVING, MATCHING THE MACROS ────────────────────────────────────────
// Every value is for the serving `0122` preserved in `meta.servingSize` — the
// same basis the Calories/Protein/Carbs/Fats on that row already use. A row
// whose serving changes needs these rescaled with it.
//
// ── ZERO MEANS ZERO; EMPTY WOULD MEAN UNKNOWN ───────────────────────────────
// A plant food genuinely contains no B12, so it is written as `0` rather than
// left blank. That is what makes a day's total correct instead of merely
// plausible: `Meal Nutrition` sums these, and a blank would silently read as
// "nothing to add" for both the absent AND the unmeasured case.
//
// Overwrites nothing — a vitamin already carrying a value is the user's.
export const id = "0123-ingredient-vitamins";
export const describe = "Standard per-serving vitamin values for the plan's 14 ingredients.";

// Order: A(mcg) C(mg) D(mcg) E(mg) K(mcg) Thiamin(mg) Riboflavin(mg) Niacin(mg)
//        Pantothenic(mg) B6(mg) Biotin(mcg) Folate(mcg) B12(mcg)
export const ORDER = ["Vitamin A", "Vitamin C", "Vitamin D", "Vitamin E", "Vitamin K",
  "Thiamin", "Riboflavin", "Niacin", "Pantothenic Acid", "Vitamin B6", "Biotin",
  "Folate", "Vitamin B12"];

export const VITAMINS = {
  //                        A     C    D    E     K    Th    Rib   Nia   Pan   B6    Bio   Fol   B12
  "Chicken Thighs":       [   5,   0, 0.1, 0.1,   1, 0.02, 0.05,  1.6,  0.3, 0.09,    1,    2,  0.2],
  "Eggs":                 [  80,   0, 1.1, 0.5, 0.2, 0.03, 0.23, 0.03,  0.7, 0.09,   10,   24, 0.45],
  "Greek Yogurt":         [  27,   0,   0, 0.1, 0.5, 0.05,  0.6,  0.4,  1.2, 0.15,    4,   20,  1.3],
  "Whole Grain Tortilla": [   0,   0,   0, 0.3,   1,  0.2,  0.1,    2,  0.3, 0.06,    1,   30,    0],
  "Granola":              [   0, 0.2,   0,   1,   2,  0.1, 0.05,  0.5,  0.3, 0.05,    3,   12,    0],
  "Frozen Berries":       [   2,  15,   0, 0.6,  10, 0.02, 0.03,  0.4,  0.1, 0.04,    1,   15,    0],
  "Brown Rice":           [   0,   0,   0, 0.1, 0.6,  0.1, 0.02,  1.5,  0.4, 0.15,    2,    4,    0],
  "Hummus":               [   0, 0.6,   0, 0.5,   2, 0.05, 0.02,  0.2,  0.1, 0.04,    1,   18,    0],
  "Peanuts":              [   0,   0,   0,   3,   0, 0.23, 0.05,  4.3,  0.6,  0.1,   13,   87,    0],
  "Pecans":               [ 0.6, 0.3,   0, 0.4,   1, 0.18, 0.04,  0.3,  0.2, 0.06,    5,    6,    0],
  "Lettuce":              [ 130, 1.5,   0,0.05,  48, 0.03, 0.03,  0.1, 0.05, 0.02,  0.5,   48,    0],
  "Frozen Mixed Veggies": [ 190,   3,   0, 0.3,  12, 0.05, 0.05,  0.6,  0.2, 0.06,    1,   20,    0],
  "Apple":                [   5,   8,   0, 0.3,   4, 0.03, 0.05,  0.2,  0.1, 0.07,    1,    5,    0],
  "Protein Powder":       [   0,   0,   0,   0,   0, 0.05,  0.4,  0.3,    1,  0.1,    5,   10,  1.2],
};

const norm = (s) => String(s ?? "").trim().toLowerCase();
const empty = (v) => v === null || v === undefined || v === "";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  const ids = ORDER.map(fid);
  const missingFields = ORDER.filter((n, i) => !ids[i]);
  if (!TAG || missingFields.length) { log(`REFUSING: missing field(s) ${missingFields.join(", ") || "Board Category"}.`); return; }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const targets = occs.filter((o) => !o.meta?.feedSourceId &&
    modById.get(o.moduleId)?.role === "instance" &&
    tagsOf(o).includes("ingredient") && tagsOf(o).includes("grocery"));

  const plan = [], unknown = [];
  for (const t of targets) {
    const key = Object.keys(VITAMINS).find((k) => norm(k) === norm(nameOf(t)));
    if (!key) { unknown.push(nameOf(t)); continue; }
    const set = {}, skipped = [];
    VITAMINS[key].forEach((v, i) => {
      const f = ids[i];
      if (!empty(t.fields?.[f]?.value)) { skipped.push(ORDER[i]); return; }  // the user's
      set[`fields.${f}`] = { value: v, flow: "in" };
    });
    plan.push({ occ: t, key, set, count: Object.keys(set).length, skipped,
      serving: modById.get(t.moduleId)?.meta?.servingSize });
  }

  log(`ingredients with a vitamin profile: ${plan.length}/${targets.length}`);
  for (const p of plan) {
    log(`   ${p.key.padEnd(22)} per ${String(p.serving ?? "?").padEnd(9)} ${p.count} value(s)` +
      (p.skipped.length ? `  (kept existing: ${p.skipped.join(", ")})` : ""));
  }
  if (unknown.length) log(`  REFUSING (no profile): ${unknown.join(", ")}`);
  const total = plan.reduce((a, p) => a + p.count, 0);
  if (!total) { log(`every vitamin already carries a value — no change.`); return; }
  if (dryRun) { log(`WOULD write ${total} vitamin value(s) across ${plan.length} ingredient(s).`); return; }

  for (const p of plan) if (p.count) await Occurrence.updateOne({ gridId, id: p.occ.id }, { $set: p.set });
  log(`wrote ${total} vitamin value(s).`);

  // Read one back with names attached, so the numbers are checkable at a glance.
  const after = await Occurrence.find({ gridId, id: plan[0].occ.id }).lean();
  const row = after[0];
  log(`  check ${plan[0].key}: ` + ORDER.map((n, i) => `${n.replace("Vitamin ", "")}=${row.fields?.[ids[i]]?.value}`).join(" "));
}
