// server/migrations/0117-fourth-set.mjs
//
// User, 2026-08-13, choosing between the options: "Add Set 4 / Weight 4".
//
// The Fitness Plan prescribes **4 sets on the compound lifts** and 3 on the
// isolation work, but the `Exercise` action only bound Set 1-3 / Weight 1-3 —
// so a 4-set compound could not be recorded at all and the fourth set had to be
// carried in the user's head.
//
// WHICH LIFTS GET FOUR IS READ FROM THE PLAN, not guessed: the numbered entries
// that say "4 sets of …" are Bench Press, Dumbbell Shoulder Press, Barbell
// Squats, Romanian Deadlifts, Calf Raises, Deadlifts, Pull-Ups and Bent-Over
// Rows. Everything else stays at three and its `Set 4` is left EMPTY rather than
// zero — empty means "this lift has three sets", zero would mean "four sets, the
// last one of nothing".
//
// THE BINDING GOES ON EVERY `Exercise` MODULE, not just the catalog one. Each
// placed row is a CLONE with its own module and its own `fieldBindings` (that is
// how APPLY_TEMPLATE works here), so binding only the catalog action would give
// the field to future rows and leave every row already on the schedule without
// the control. The catalog is included so new clones inherit it.
//
// Set 4 is inserted directly AFTER Set 3 (and Weight 4 after Weight 3) rather
// than appended, so the row reads 1,2,3,4 in order — `fieldBindings` order is
// render order.
import { randomUUID } from "node:crypto";

export const id = "0117-fourth-set";
export const describe = "Set 4 / Weight 4 on the Exercise action, with the plan's 4-set compounds filled.";

// Straight from Fitness Plan.md — the numbered entries reading "4 sets of …".
export const FOUR_SET_LIFTS = [
  "Barbell Bench Press", "Dumbbell Shoulder Press",
  "Barbell Squats", "Romanian Deadlifts", "Calf Raises",
  "Deadlifts", "Pull-Ups", "Bent-Over Rows",
];

const norm = (s) => String(s ?? "").trim().toLowerCase();

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
  const S3 = fid("Set 3"), W3 = fid("Weight 3"), MOV = fid("Movement");
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  if (!S3 || !W3 || !MOV || !TAG) { log(`REFUSING: missing Set 3 / Weight 3 / Movement / Board Category.`); return; }

  let S4 = fid("Set 4"), W4 = fid("Weight 4");
  const s3f = fields.find((f) => f.id === S3), w3f = fields.find((f) => f.id === W3);

  // Every module that binds Movement is an Exercise row's template.
  const exerciseMods = mods.filter((m) => (m.fieldBindings || []).some((b) => b.fieldId === MOV));
  const needBinding = exerciseMods.filter((m) =>
    !(m.fieldBindings || []).some((b) => b.fieldId === S4));

  const movements = occs.filter((o) => {
    const v = o.fields?.[TAG]?.value; const a = Array.isArray(v) ? v : v ? [v] : [];
    return a.includes("movement") && !o.meta?.feedSourceId &&
      modById.get(o.moduleId)?.role === "instance";
  });
  const four = movements.filter((m) => FOUR_SET_LIFTS.some((l) => norm(l) === norm(nameOf(m))));
  const missing = FOUR_SET_LIFTS.filter((l) => !movements.some((m) => norm(nameOf(m)) === norm(l)));

  log(`Set 4 field: ${S4 ? "exists" : "WILL CREATE"} · Weight 4: ${W4 ? "exists" : "WILL CREATE"}`);
  log(`Exercise-shaped modules: ${exerciseMods.length}, needing the binding: ${needBinding.length}`);
  log(`4-set compounds found: ${four.length}/${FOUR_SET_LIFTS.length}` +
    (missing.length ? `  MISSING: ${missing.join(", ")}` : ""));
  for (const m of four) log(`   ${nameOf(m).padEnd(26)} sets 1-3 = ${[fid("Set 1"), fid("Set 2"), S3].map((f) => m.fields?.[f]?.value ?? "-").join(",")} -> Set 4 gets the same`);
  if (dryRun) { log(`WOULD create the fields, bind ${needBinding.length} module(s), fill ${four.length} lift(s).`); return; }

  const userId = mods[0]?.userId ?? occs[0]?.userId;
  if (!S4) {
    S4 = randomUUID();
    await Field.create({ ...(s3f || {}), _id: undefined, id: S4, gridId, userId,
      name: "Set 4", type: s3f?.type || "number", inputEnabled: true, displayEnabled: false,
      meta: { ...(s3f?.meta || {}) } });
  }
  if (!W4) {
    W4 = randomUUID();
    await Field.create({ ...(w3f || {}), _id: undefined, id: W4, gridId, userId,
      name: "Weight 4", type: w3f?.type || "number", inputEnabled: true, displayEnabled: false,
      meta: { ...(w3f?.meta || {}) } });
  }

  // Insert after Set 3 / Weight 3 — fieldBindings order is render order.
  for (const m of needBinding) {
    const next = [];
    for (const b of m.fieldBindings || []) {
      next.push(b);
      if (b.fieldId === S3) next.push({ ...b, fieldId: S4 });
      if (b.fieldId === W3) next.push({ ...b, fieldId: W4 });
    }
    if (!next.some((b) => b.fieldId === S4)) next.push({ fieldId: S4, role: "input", hidden: false });
    if (!next.some((b) => b.fieldId === W4)) next.push({ fieldId: W4, role: "input", hidden: false });
    await Module.updateOne({ gridId, id: m.id }, { $set: { fieldBindings: next } });
  }

  // The prescription lives on the movement OPTION, which is where every placed
  // row copies its sets from — same source `0108` used.
  for (const m of four) {
    const reps = m.fields?.[S3]?.value;
    if (reps === null || reps === undefined) { log(`  skipping ${nameOf(m)} — no Set 3 to copy`); continue; }
    await Occurrence.updateOne({ gridId, id: m.id },
      { $set: { [`fields.${S4}`]: { value: reps, flow: "in" } } });
  }
  log(`created Set 4 (${S4}) / Weight 4 (${W4}), bound ${needBinding.length} module(s), filled ${four.length} lift(s).`);
}
