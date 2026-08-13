// server/migrations/0113-drop-stale-slot-listings.mjs
//
// Fallout of the clobber `0111` repaired, caught by reading the column back
// rather than trusting that repair: **Hygiene was listed by BOTH 7:00am and
// 7:30am.** Its own `parentId` says 7:30am — the 7:00am entry is the stale
// array the browser tab echoed back, and re-linking it into 7:30am left it in
// two places at once.
//
// THE RULE IS NARROW ON PURPOSE, because multi-parenting is a real and load-
// bearing pattern here: the Schedule shares one slot across day columns, and
// `Schedule: Place Dated Work` multi-parents a task into several days so that
// ticking it once ticks it everywhere. Unlisting those would fork state.
//
// So this only removes a listing when the SAME ROOT (one day column, or one
// template) has ANOTHER slot that the child names as its `parentId`. A row
// cannot be in two timeslots of the same day — that is not multi-parenting,
// it is a stale entry. Anything whose parentId points outside this root, or
// that no other slot claims, is left completely alone.
export const id = "0113-drop-stale-slot-listings";
export const describe =
  "A row listed by two slots of the same day is unlisted from the one that is not its parent.";

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
  const TS = fid("Time Slot"), DATE = fid("Date"), FMT = fid("Schedule Format");
  if (!TS) { log(`REFUSING: no "Time Slot" field.`); return; }

  // Every root whose children are slots: the day columns and the templates.
  const roots = occs.filter((o) => o.fields?.[FMT]?.value === "day-col" ||
    modById.get(o.moduleId)?.meta?.templateModule === true ||
    o.identitySignature === "day-container");

  const drops = [];
  for (const root of roots) {
    const slots = (root.occurrences || []).map((i) => byId.get(i)).filter(Boolean)
      .filter((s) => s.fields?.[TS]?.value);
    const slotIds = new Set(slots.map((s) => s.id));
    for (const s of slots) {
      for (const cid of s.occurrences || []) {
        const child = byId.get(cid);
        if (!child || child.parentId === s.id) continue;
        // Only when the real parent is ANOTHER slot of this same root.
        if (!child.parentId || !slotIds.has(child.parentId)) continue;
        drops.push({
          slot: s, childId: cid,
          label: nameOf(child),
          from: String(s.fields[TS].value),
          to: String(byId.get(child.parentId)?.fields?.[TS]?.value),
          where: String(root.fields?.[DATE]?.value ?? nameOf(root)).slice(0, 24),
        });
      }
    }
  }

  for (const d of drops) log(`  ${d.where}: "${d.label}" listed by ${d.from} but parented to ${d.to} — unlisting from ${d.from}`);
  if (!drops.length) { log(`no stale slot listings.`); return; }
  if (dryRun) { log(`WOULD unlist ${drops.length}.`); return; }
  for (const d of drops) {
    // $pull only — the occurrence itself is never touched. It stays exactly
    // where its parentId says it is.
    await Occurrence.updateOne({ gridId, id: d.slot.id }, { $pull: { occurrences: d.childId } });
  }
  log(`unlisted ${drops.length} stale listing(s).`);
}
