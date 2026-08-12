// server/migrations/0077-unique-field-names.mjs
//
// The user's standing rule, set 2026-07-14: *"there shouldnt be duplicate field
// names."* `FieldsTab` has ENFORCED it for new fields since `42c56c21` — but
// five pairs predate the enforcement and survived, on the live grid AND on a
// freshly seeded one. `2026-08-01 (18)` filed them as "worth a pass"; this is
// that pass.
//
// ── EVERY PAIR IS AN INPUT FIELD AND ITS DISPLAY TWIN ──────────────────────
//
//   Due       date   input   bound by 4, 6 values   |  number  display  "Due This Week"
//   Calories  number input   bound by 20, 15 values |  number  display  "Total Calories"
//   Protein   ditto                                 |  ditto   "Total Protein"
//   Carbs     ditto                                 |  ditto   "Total Carbs"
//   Fats      ditto                                 |  ditto   "Total Fats"
//
// Only the DISPLAY twin is renamed. The input field is the one people type
// into, the one `[Field]` label tokens name, and the one 20 modules bind — its
// name is the user's vocabulary and is not mine to change.
//
// ── WHY THIS IS MORE THAN COSMETIC ────────────────────────────────────────
//
// Resolve-by-name is used everywhere a migration or a builder looks a field up,
// and with two matches it returns whichever Mongo hands back first. `0053`
// records paying for exactly this: *"this grid has TWO fields called 'Due' ...
// name alone picks whichever Mongo returns first"*, so it had to discriminate
// by TYPE. Every future lookup inherits that hazard until the names are unique.
//
// ── THE NAMES COME FROM THE SEED'S OWN KEYS, NOT FROM ME ──────────────────
//
// `totalProtein` / `totalCalories` / `totalCarbs` / `totalFats` /
// `upcomingThisWeek` — the seed already calls its other display twins "Total
// Phone Calls", "Total Workouts", "Total Reps", "Total Reading Time". The
// `Due` twin is `upcomingThisWeek` with postfix " tasks", which is "Due This
// Week"; naming it "Due" was the mistake.
//
// THE SEED IS FIXED IN THE SAME COMMIT, so a reseeded grid and a migrated grid
// cannot drift — the "shipped and does nothing" class this repo keeps paying
// for when only one half moves.
//
// ── CHECKED BEFORE WRITING: NO LABEL TOKEN NAMES ONE ──────────────────────
//
// `[Field]` / `{Field}` label tokens resolve BY NAME (2026-07-14 (3)), so a
// rename could silently blank a rendered value. Scanned every module and
// occurrence label on both grids: 0 tokens name any of the five, and the scan
// demonstrably fires (it found the one real token, `Project: {ProjectName}`).

export const id = "0077-unique-field-names";
export const describe =
  "Renames the five DISPLAY twins that share a name with their input field "
  + "(Calories/Protein/Carbs/Fats -> Total X, and the 'Due' number tile -> "
  + "'Due This Week'), so resolve-by-name stops being a coin flip.";

/**
 * name -> the display twin's new name. Keyed by the CURRENT duplicate name;
 * only a field that is display-only is ever touched.
 */
export const RENAMES = {
  "calories": "Total Calories",
  "protein": "Total Protein",
  "carbs": "Total Carbs",
  "fats": "Total Fats",
  "due": "Due This Week",
};

/**
 * Which fields to rename. PURE — the discriminator is the whole risk, because
 * renaming the INPUT field instead would rewrite the user's own vocabulary.
 *
 * @returns [{ field, to }]
 */
export function planRenames(fields) {
  const byName = new Map();
  for (const f of fields) {
    const k = (f.name || "").toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(f);
  }
  const out = [];
  for (const [k, list] of byName) {
    const to = RENAMES[k];
    if (!to) continue;
    // Only act on a genuine COLLISION. A grid where the name is already unique
    // needs nothing, which is also what makes a re-run a no-op.
    if (list.length < 2) continue;
    const twins = list.filter(f => f.displayEnabled === true && f.inputEnabled !== true);
    // Refuse anything ambiguous rather than guessing which one the user types
    // into. Exactly one display-only twin, or this pair is left alone.
    if (twins.length !== 1) continue;
    // And never collide with a name that is already taken.
    if (fields.some(f => (f.name || "").toLowerCase() === to.toLowerCase())) continue;
    out.push({ field: twins[0], to });
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const fields = await Field.find({ gridId }).lean();

  const plan = planRenames(fields);
  const dupes = Object.entries(
    fields.reduce((a, f) => { const k = (f.name || "").toLowerCase(); a[k] = (a[k] || 0) + 1; return a; }, {}),
  ).filter(([, n]) => n > 1);

  log(`duplicate field names on this grid: ${dupes.length}${dupes.length ? ` (${dupes.map(([k, n]) => `${k}×${n}`).join(", ")})` : ""}`);
  if (!plan.length) { log("nothing renameable — every duplicate is already unique or ambiguous"); return; }
  for (const p of plan) {
    log(`   "${p.field.name}" [${p.field.id.slice(0, 8)}] display-only → "${p.to}"`);
  }
  // Name the ones this REFUSES, so an ambiguous pair is visible rather than
  // silently skipped.
  const untouched = dupes.filter(([k]) => !plan.some(p => (p.field.name || "").toLowerCase() === k));
  if (untouched.length) log(`   ⚠ left alone (no single display-only twin): ${untouched.map(([k]) => k).join(", ")}`);

  if (dryRun) { log("DRY RUN — nothing written"); return; }

  for (const p of plan) {
    await Field.updateOne({ gridId, id: p.field.id }, { $set: { name: p.to } });
  }
  log(`✓ renamed ${plan.length} display field(s); resolve-by-name is unambiguous again`);
}
