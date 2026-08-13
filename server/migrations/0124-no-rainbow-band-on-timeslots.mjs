// server/migrations/0124-no-rainbow-band-on-timeslots.mjs
//
// User, 2026-08-13: "turn off the rainbow headers on the schedule" … "turn it
// off on the timeslots i mean."
//
// The retro-rainbow band (2026-08-12) is a `::after` on every
// `.container-shell > .container-header`. That reads as an accent on a page or
// a board — but a schedule day column stacks **49 slot containers**, so one
// accent became 49 stripes down the column and stopped being an accent at all.
//
// IT IS TURNED OFF AS DATA, NOT AS A SELECTOR. `client/src/index.css` may not
// name a timeslot: `__tests__/noDomainKnowledge.test.js` fails the build if the
// generic renderer or its stylesheet learns what a "schedule" is, and that rule
// has been earned twice (the hardcoded timeslot-passed tint, 2026-06-03; the
// `SCHEDULE_LABEL_PREFIX` header, 2026-07-26). So the renderer reads
// `module.meta.headerBand === false` and adds `container-header--no-band`;
// this migration sets that flag. Any container can opt out; nothing knows why.
//
// **WHICH CONTAINERS IS STRUCTURAL: does it carry a `Time Slot` value.** That
// is what a slot IS — not its label ("7:00am" is a rename away from wrong) and
// not its parent. It catches the day columns' slots, the five templates' slots,
// and any slot minted later by the same rule.
//
// THE DAY COLUMN ITSELF KEEPS ITS BAND. It carries a Time Slot value too (the
// build op stamps one), but it is the one header per column that a band flatters
// rather than repeats — so a column-level `Schedule Format` of "day-col" is
// excluded explicitly.
export const id = "0124-no-rainbow-band-on-timeslots";
export const describe = "Timeslot containers opt out of the rainbow header band.";

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
  const TS = fid("Time Slot"), FMT = fid("Schedule Format");
  if (!TS || !FMT) { log(`REFUSING: missing Time Slot / Schedule Format field.`); return; }

  const targets = new Map();          // moduleId -> a sample occurrence, for the log
  for (const o of occs) {
    if (!o.fields?.[TS]?.value) continue;                 // not a slot
    if (o.fields?.[FMT]?.value === "day-col") continue;   // the column, not a slot in it
    const m = modById.get(o.moduleId);
    if (!m || m.role !== "container") continue;           // a ROW in a slot also carries the value
    if (m.meta?.headerBand === false) continue;           // already off
    if (!targets.has(m.id)) targets.set(m.id, o);
  }

  log(`slot containers whose header still bands: ${targets.size} module(s)`);
  const sample = [...targets.values()].slice(0, 6)
    .map((o) => `${nameOf(o)}@${o.fields[TS].value}`);
  if (sample.length) log(`   e.g. ${sample.join(", ")}`);
  const columns = occs.filter((o) => o.fields?.[FMT]?.value === "day-col").length;
  log(`   day columns keeping their band: ${columns}`);
  if (!targets.size) { log(`nothing to change.`); return; }
  if (dryRun) { log(`WOULD set meta.headerBand = false on ${targets.size} module(s).`); return; }

  // $set the one key rather than writing meta whole — a slot module carries
  // identity markers there (0006's lesson about clobbering meta).
  await Module.updateMany(
    { gridId, id: { $in: [...targets.keys()] } },
    { $set: { "meta.headerBand": false } },
  );
  const after = await Module.find({ gridId, "meta.headerBand": false }).lean();
  log(`set on ${targets.size}; ${after.length} module(s) now opt out.`);
}
