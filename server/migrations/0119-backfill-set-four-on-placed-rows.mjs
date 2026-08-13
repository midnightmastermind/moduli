// server/migrations/0119-backfill-set-four-on-placed-rows.mjs
//
// Caught by reading today's column back after `0117`: the 4-set compounds show
// `sets=[6,6,6,-]`. `0117` put Set 4 on the movement OPTION — which is where a
// newly placed row copies its sets from — but every row ALREADY on a template or
// on today's column had copied its sets before the field existed. So the
// prescription was right in the catalog and missing everywhere it is read.
//
// It fills Set 4 (and Weight 4) on a placed row FROM THE MOVEMENT IT PICKED, so
// there is one source for the prescription and no second list to drift.
//
// **ONLY WHEN THE ROW'S OWN VALUE IS EMPTY.** A row is a LOG as well as a
// prescription — once a set is performed the number on the row is the user's
// record of what they did, and overwriting it from the catalog would rewrite
// history. Empty means "never filled", which is the only case this touches.
export const id = "0119-backfill-set-four-on-placed-rows";
export const describe = "Placed Exercise rows inherit Set 4 / Weight 4 from the movement they picked.";

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
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const MOV = fid("Movement"), S4 = fid("Set 4"), W4 = fid("Weight 4");
  if (!MOV || !S4) { log(`REFUSING: no Movement / Set 4 field — run 0117 first.`); return; }

  const empty = (v) => v === null || v === undefined || v === "";
  const fixes = [];
  for (const o of occs) {
    const v = o.fields?.[MOV]?.value;
    const ids = Array.isArray(v) ? v : v ? [v] : [];
    if (!ids.length) continue;
    const src = byId.get(ids[0]);
    if (!src) continue;                       // a dangling pick is 0114's problem
    const set = {};
    for (const f of [S4, W4]) {
      if (!f) continue;
      const from = src.fields?.[f]?.value;
      if (empty(from)) continue;              // the movement prescribes only 3
      if (!empty(o.fields?.[f]?.value)) continue;  // the user's own log — never
      set[`fields.${f}`] = { ...src.fields[f] };
    }
    if (Object.keys(set).length) fixes.push({ occ: o, set, label: nameOf(src) });
  }

  const byName = new Map();
  for (const f of fixes) byName.set(f.label, (byName.get(f.label) || 0) + 1);
  log(`placed rows inheriting a 4th set: ${fixes.length}`);
  [...byName.entries()].forEach(([k, v]) => log(`   ${String(v).padStart(2)}× ${k}`));
  if (!fixes.length) { log(`nothing to backfill.`); return; }
  if (dryRun) { log(`WOULD fill ${fixes.length} row(s).`); return; }

  for (const f of fixes) await Occurrence.updateOne({ gridId, id: f.occ.id }, { $set: f.set });
  log(`filled ${fixes.length} row(s).`);
}
