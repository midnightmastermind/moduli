// server/migrations/0111-relink-clobbered-placements.mjs
//
// User, 2026-08-13: "none show up on today right now, which they should."
//
// THE ROWS WERE NEVER DELETED — THEIR PARENT STOPPED LISTING THEM. Measured
// after the report: all 72 Eat/Exercise rows still exist, and **9 of them are
// unlisted by the slot they name as their parent** — the 7:00am Eat and all
// eight Exercise rows. Hygiene was back in 7:00am and the Hot Tub gone from
// 7:30am. A sweep would have DELETED them; an array overwrite leaves them
// alive and invisible, which is exactly what was on screen.
//
// THE CAUSE IS THE DOCUMENTED SELF-RESTORING CLASS (CLAUDE.md 2026-07-29):
// "the client holds whatever the last full_state gave it and echoes the whole
// array back, so sweeping the DB fixed nothing". `0106`/`0108` wrote
// `occurrences[]` directly on slots WHILE A BROWSER TAB WAS CONNECTED holding
// the pre-migration arrays; the tab's next write echoed its stale copy over
// them. The pure ADDs to slots the tab had not touched survived — which is why
// the meals at 9:00am onward were fine and only the two slots the MOVE touched
// came back wrong.
//
// **THE RULE, and it is the one to keep: a migration that writes `occurrences[]`
// needs the client gone, not just the server restarted.** A server restart
// clears the warm cache, which is necessary and was not sufficient — the stale
// array was in the BROWSER.
//
// This repair is written to be re-runnable for exactly that reason: if a tab
// clobbers it again it can simply be run again, and it converges.
export const id = "0111-relink-clobbered-placements";
export const describe =
  "Re-link placed Eat/Exercise rows their slot stopped listing, and restore the post-workout slot.";

export const TARGET_DATE = "2026-08-13";
export const HYGIENE_TO = "7:30am";
export const POST_WORKOUT = ["Hygiene", "Hot Tub"];

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
  const MOV = fid("Movement"), MEAL = fid("Meal");
  if (!TS || !DATE || !FMT) { log(`REFUSING: missing Time Slot / Date / Schedule Format.`); return; }

  const pick = (o) => {
    const mv = o.fields?.[MOV]?.value, ml = o.fields?.[MEAL]?.value;
    const ids = Array.isArray(mv) ? mv : mv ? [mv] : [];
    if (ids.length) return nameOf(byId.get(ids[0]));
    return ml ? nameOf(byId.get(ml)) : null;
  };

  // 1. A placed row whose own parent does not list it. Scoped to rows carrying
  //    a PICK — those are the ones this session placed. A row with no parent at
  //    all is a different problem (sweepOrphans owns it) and is left alone.
  const relink = [];
  for (const o of occs) {
    if (!["Eat", "Exercise"].includes(nameOf(o)) || !pick(o)) continue;
    const p = byId.get(o.parentId);
    if (!p) continue;
    if ((p.occurrences || []).includes(o.id)) continue;
    // Only re-link into a real slot — never invent a placement somewhere else.
    if (!p.fields?.[TS]?.value) continue;
    relink.push({ occ: o, slot: p, label: `${nameOf(o)}[${pick(o)}]` });
  }

  // 2. Hygiene and the Hot Tub belong in the post-workout slot on today's column.
  const col = occs.find((o) => o.fields?.[FMT]?.value === "day-col" &&
    String(o.fields?.[DATE]?.value ?? "").slice(0, 10) === TARGET_DATE);
  const moves = [], adds = [];
  if (col) {
    const slots = new Map();
    for (const s of (col.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
      const t = s.fields?.[TS]?.value; if (t) slots.set(String(t), s);
    }
    const to = slots.get(HYGIENE_TO);
    if (to) {
      const there = new Set((to.occurrences || []).map((i) => nameOf(byId.get(i))));
      for (const label of POST_WORKOUT) {
        // Wherever it currently sits under this column, or detached with its
        // parentId still naming one of this column's slots.
        const found = occs.find((o) => nameOf(o) === label &&
          [...slots.values()].some((s) => s.id === o.parentId));
        if (!found) continue;
        if (there.has(label) && (to.occurrences || []).includes(found.id)) continue;
        if (found.parentId === to.id) adds.push({ occ: found, slot: to, label });
        else moves.push({ occ: found, from: byId.get(found.parentId), to, label });
      }
    }
  }

  for (const r of relink) log(`  relink ${r.label} -> ${r.slot.fields[TS].value}`);
  for (const m of moves) log(`  move   ${m.label} ${m.from?.fields?.[TS]?.value} -> ${HYGIENE_TO}`);
  for (const a of adds) log(`  relist ${a.label} in ${HYGIENE_TO}`);
  if (!relink.length && !moves.length && !adds.length) { log(`nothing unlinked — no change.`); return; }
  if (dryRun) { log(`WOULD relink ${relink.length}, move ${moves.length}, relist ${adds.length}.`); return; }

  // $push with a $ne guard rather than writing the whole array — the array is
  // the very thing that got clobbered, and a read-modify-write here would race
  // any client doing the same.
  for (const r of relink) {
    await Occurrence.updateOne({ gridId, id: r.slot.id, occurrences: { $ne: r.occ.id } },
      { $push: { occurrences: r.occ.id } });
  }
  for (const m of moves) {
    if (m.from) await Occurrence.updateOne({ gridId, id: m.from.id }, { $pull: { occurrences: m.occ.id } });
    await Occurrence.updateOne({ gridId, id: m.to.id, occurrences: { $ne: m.occ.id } },
      { $push: { occurrences: m.occ.id } });
    await Occurrence.updateOne({ gridId, id: m.occ.id },
      { $set: { parentId: m.to.id, [`fields.${TS}`]: { value: HYGIENE_TO, flow: "in" } } });
  }
  for (const a of adds) {
    await Occurrence.updateOne({ gridId, id: a.slot.id, occurrences: { $ne: a.occ.id } },
      { $push: { occurrences: a.occ.id } });
  }
  log(`relinked ${relink.length}, moved ${moves.length}, relisted ${adds.length}.`);
}
