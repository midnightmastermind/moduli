// server/migrations/0109-drop-empty-eat-and-exercise.mjs
//
// User, 2026-08-13: "i dont need the original eat thats empty or any empty
// excersise."
//
// Once `0108` gave every meal a real `Eat` row with the Meal picked and every
// lift an `Exercise` row with the Movement picked, the generic 8:00am "Eat" and
// 5:00pm "Exercise" are leftovers: a row that says you ate without saying what,
// sitting beside eight rows that say exactly what.
//
// THE DISCRIMINATOR IS STRUCTURAL — "does it sit in a TIMESLOT" — and it is the
// whole safety of this migration. The Routines catalog holds the ONE canonical
// `Eat` (under Physical > Nutrition) and `Exercise` (under Physical > Fitness);
// those are the actions every placed row is cloned FROM, and deleting them
// would break `0108`'s rule and the "+ Add" flow for good. They are not in a
// slot, so they are not placements, so they are never touched. Matching on the
// label alone would have taken them.
//
// Measured before writing — 86 Eat/Exercise occurrences on the grid, of which
// the ones with NO pick are:
//     Routines > Nutrition / Fitness      the catalog          <- KEPT
//     "Day" template                      Eat 8:00am, Exercise 5:00pm
//     Schedule - Day 1..4                 Eat 8:00am
//     today's column                      Eat 8:00am
//     three slots whose day column is gone (swept rebuilds)
//
// THE "Day" TEMPLATE IS INCLUDED ON PURPOSE. It is what `Schedule: Build
// Schedule` still applies every morning, so leaving its empty Eat in place
// would put one back on tomorrow's column and make this look like it silently
// failed overnight.
//
// A ROW WITH A PICK IS NEVER TOUCHED, and neither is one carrying anything the
// user did: a ticked Completed is the record that you ate, and deleting it is
// data loss dressed as tidying.
export const id = "0109-drop-empty-eat-and-exercise";
export const describe =
  "Empty Eat / Exercise placements come off the schedule — the Routines catalog keeps its own.";

export const LABELS = ["Eat", "Exercise"];
// Written by the app or by structure, never typed by the user — their presence
// is not evidence the row means something.
export const STRUCTURAL_FIELDS = [
  "Time Slot", "Date", "Category", "Tags", "Last Seen", "Habit", "Board Category",
];

const empty = (v) => v === null || v === undefined || v === "" ||
  (Array.isArray(v) && v.length === 0);

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const fById = new Map(fields.map((f) => [f.id, f]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const TS = fid("Time Slot"), MOV = fid("Movement"), MEAL = fid("Meal");
  const COMPLETED = fid("Completed");
  if (!TS || !MOV || !MEAL) { log(`REFUSING: missing Time Slot / Movement / Meal field.`); return; }
  const structural = new Set(STRUCTURAL_FIELDS.map(fid).filter(Boolean));

  const drops = [], kept = [];
  for (const o of occs) {
    if (!LABELS.includes(nameOf(o))) continue;

    // A placement is a row whose PARENT is a timeslot. The catalog's Eat sits
    // in "Nutrition", which carries no Time Slot — so it is not a placement.
    const slot = byId.get(o.parentId);
    const slotTime = slot?.fields?.[TS]?.value;
    if (!slotTime) continue;

    if (!empty(o.fields?.[MOV]?.value) || !empty(o.fields?.[MEAL]?.value)) continue;

    const entered = Object.entries(o.fields || {}).filter(
      ([f, v]) => !structural.has(f) && !empty(v?.value),
    );
    const ticked = o.fields?.[COMPLETED]?.value === true;
    const kids = (o.occurrences || []).length;
    const where = nameOf(byId.get(slot.parentId));
    if (ticked || entered.length || kids) {
      kept.push({ where, slotTime, label: nameOf(o),
        why: ticked ? "Completed is ticked"
          : kids ? `${kids} child(ren)`
            : `carries ${entered.map(([f]) => fById.get(f)?.name).join(", ")}` });
      continue;
    }
    drops.push({ occ: o, where, slotTime, label: nameOf(o) });
  }

  for (const d of drops) log(`  - ${String(d.label).padEnd(9)} ${String(d.slotTime).padEnd(9)} in ${d.where}`);
  for (const k of kept) log(`  KEEPING ${k.label} ${k.slotTime} in ${k.where} — ${k.why}`);

  // The catalog is reported rather than assumed safe — a rule nobody has
  // watched decline is a guess.
  const catalog = occs.filter((o) => LABELS.includes(nameOf(o)) &&
    !byId.get(o.parentId)?.fields?.[TS]?.value);
  log(`  catalog / non-slot rows left alone: ${catalog.length}` +
    ` (${catalog.map((o) => `${nameOf(o)}@${nameOf(byId.get(o.parentId))}`).join(", ")})`);

  if (!drops.length) { log(`nothing empty to remove.`); return; }
  if (dryRun) { log(`WOULD remove ${drops.length} empty placement(s).`); return; }

  for (const d of drops) {
    await Occurrence.updateOne({ gridId, id: d.occ.parentId }, { $pull: { occurrences: d.occ.id } });
    await Occurrence.deleteOne({ gridId, id: d.occ.id });
  }
  log(`removed ${drops.length} empty Eat/Exercise placement(s).`);
}
