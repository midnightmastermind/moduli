/**
 * 0165 — the micronutrient tile stops lying: Vitamin D was off by 40x, and sodium ran backwards.
 *
 * Filed as *"Vitamin E / K / B6 / Folate have fields and values but no target — the guide gives
 * none."* **That item was STALE.** All four have targets (15 · 120 · 1.3 · 400), all fourteen totals
 * are bound to the Vitamins & Minerals tile, and all fourteen are written by
 * `Nutrition: Today's Micronutrients`. Measured before anything was written — and measuring is what
 * turned a paperwork item into two real defects.
 *
 * **DEFECT 1 — VITAMIN D IS OFF BY FORTY.** Its target is `600`, which is the **IU** figure; the
 * modern DRI is **15 mcg**, the same amount in different units. The per-ingredient values are
 * already in **mcg** — established against a food whose answer is known rather than by reading the
 * field name:
 * ```
 *   Eggs            1.1     one large egg = 1.1 mcg  = 44 IU     -> the values are mcg
 *   Chicken Thighs  0.1
 * ```
 * So the tile has been summing mcg and comparing the total against an IU target: a day that fully
 * meets the requirement reads as **2.5% of goal**. Nothing errored and no number looked absurd,
 * which is exactly why it survived. The target moves to 15; **not one stored value is touched**,
 * because they were already right.
 *
 * **DEFECT 2 — SODIUM WAS A GOAL TO REACH.** 2300 mg is the chronic-disease-risk-reduction UPPER
 * LIMIT, and `displayConfigTarget` defaults to `op: ">="`, so the tile turned **green once you went
 * OVER your sodium limit**. It carries `targetOp: "<="` now — the countdown semantic `Tasks Left`
 * already uses — so it reads green while under and red once crossed. The number stays 2300 (the
 * user's call over the 1500 mg Adequate Intake).
 *
 * **THE UNITS ARE STAMPED ONLY WHERE THE VALUES WERE CHECKED, and that is the whole safety of this
 * half.** Eleven input fields and four totals carried no unit at all, so a bare `900` could have
 * meant mcg RAE or IU. A unit inferred from a field's NAME would be a guess printed next to a number
 * — worse than no unit, because it looks authoritative. Every one was scale-checked against a food
 * with a known value first:
 * ```
 *   Vitamin A   Frozen Veg 380 · Lettuce 130 · Eggs 80      -> mcg RAE   (egg ~80 mcg RAE)
 *   Vitamin C   Berries 30 · Apple 8                        -> mg
 *   Vitamin B12 Greek Yogurt 1.3 · Eggs 0.45                -> mcg       (egg ~0.45 mcg)
 *   Vitamin E   Peanuts 12 · Pecans 1.6                     -> mg
 *   Vitamin K   Lettuce 48 · Frozen Veg 24                  -> mcg
 *   Folate      Peanuts 348 · Lettuce 48                    -> mcg DFE
 *   Niacin 17.2..0.03 · Thiamin 0.92..0.02 · Riboflavin 0.6..0.01 · B6 0.4..0.02  -> mg
 * ```
 *
 * **MAGNESIUM 400 -> 420**, the one figure that moves with the reference profile the user picked
 * (adult male 31-50 rather than 19-30). Every other target already matches that profile, which is
 * why nothing else changes.
 *
 * NOT IN THE SEED, and stated rather than quietly skipped: `createLiveData` does not create the
 * micronutrient fields at all — they exist only via `0152`/`0153`, so a fresh grid has no tile for
 * this to drift from. That is the `0043` gap scoped to a feature the seed never had; it is reported
 * here, not fixed here.
 *
 * Idempotent: every write is a comparison against the value already stored.
 */
export const id = "0165-micronutrient-units-and-ceilings";
export const describe =
  "Vitamin D target 600 (IU) -> 15 (mcg) — the values were always mcg; sodium becomes a ceiling; magnesium 400 -> 420; units stamped on 15 unit-less micronutrient fields.";

// name -> unit. Each was verified against a food whose value in that unit is
// known (see the header) BEFORE being listed here.
const UNITS = {
  "Vitamin A": "mcg", "Vitamin C": "mg", "Vitamin D": "mcg", "Vitamin E": "mg",
  "Vitamin K": "mcg", "Vitamin B6": "mg", "Vitamin B12": "mcg", "Folate": "mcg",
  "Niacin": "mg", "Thiamin": "mg", "Riboflavin": "mg",
};

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const fields = await Field.find({ gridId }).lean();
  const byName = new Map(fields.map((f) => [f.name, f]));

  const plan = [];

  // 1. Units — on the INPUT field and on its "Total X" display twin, since both
  //    render the number and either one alone leaves half the tile ambiguous.
  for (const [name, unit] of Object.entries(UNITS)) {
    for (const n of [name, `Total ${name}`]) {
      const f = byName.get(n);
      if (!f) continue;
      if (f.unit === unit) continue;
      plan.push({ f, patch: { unit }, why: `unit ${f.unit || "(none)"} -> ${unit}` });
    }
  }

  // 2. Vitamin D: the target was IU, the values are mcg.
  const vitD = byName.get("Total Vitamin D");
  if (vitD && vitD.displayConfig?.targetValue === 600) {
    plan.push({
      f: vitD,
      patch: { displayConfig: { ...(vitD.displayConfig || {}), targetValue: 15 } },
      why: "target 600 (IU) -> 15 (mcg) — the stored values were always mcg",
    });
  }

  // 3. Sodium is a CEILING. Without targetOp the tile greens when you exceed it.
  const na = byName.get("Total Sodium");
  if (na && na.displayConfig?.targetOp !== "<=") {
    plan.push({
      f: na,
      patch: { displayConfig: { ...(na.displayConfig || {}), targetOp: "<=" } },
      why: `target ${na.displayConfig?.targetValue} becomes a limit to stay UNDER`,
    });
  }

  // 4. The one figure that moves with the chosen reference profile.
  const mg = byName.get("Total Magnesium");
  if (mg && mg.displayConfig?.targetValue === 400) {
    plan.push({
      f: mg,
      patch: { displayConfig: { ...(mg.displayConfig || {}), targetValue: 420 } },
      why: "target 400 -> 420 (adult male 31-50)",
    });
  }

  if (!plan.length) { log("  already converged"); return; }
  log(`  ${plan.length} field change(s):`);
  for (const p of plan) log(`     ${p.f.name.padEnd(22)} ${p.why}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const p of plan) await Field.updateOne({ _id: p.f._id }, { $set: p.patch });
  log(`  patched ${plan.length} field(s) — RESTART pm2 and reload.`);
}
