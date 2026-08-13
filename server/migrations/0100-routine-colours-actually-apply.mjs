// server/migrations/0100-routine-colours-actually-apply.mjs
//
// User, 2026-08-13: "you also didnt change the color of the routine containers
// or their instances."
//
// 0097 WROTE THE COLOUR WHERE NOTHING READS IT. Comparing a dimension container
// that DOES render coloured against an action I had just "coloured":
//
//   dimension  mod.ownStyle {"bg":"#b34f24"}  mod.styleMode "own"   occ.ownStyle null
//   action     occ.ownStyle {"bg":"#c16f4b"}  occ.styleMode undefined
//                                             mod.styleMode "inherit"   <- ignored
//
// The palette lives on the MODULE and is gated by `styleMode: "own"` — an entity
// left on "inherit" takes the cascade and its own `ownStyle` is never consulted.
// So the value was stored and inert: exactly the "shipped and does nothing" class
// this repo keeps paying for, and it is why the page looked unchanged.
//
// THE PROVEN PATTERN IS FOLLOWED RATHER THAN A SECOND ONE INVENTED: module-level
// `ownStyle` + `styleMode: "own"`, the same shape the nine dimensions have used
// since 0020/0021. The occurrence-level values 0097 wrote are REMOVED in the same
// pass — leaving them would be a second source of truth for one colour, and the
// next person would not know which one wins.
//
// SUB-CONTAINERS ARE COLOURED TOO, which is the half I got wrong by choice. I
// left them transparent for a three-step hierarchy; the user asked for "the
// routine containers or their instances", so both get it — as a LADDER of one
// hue so the levels stay distinguishable:
//
//   dimension      the palette colour        (unchanged)
//   sub-container  10% toward white
//   action         22% toward white
//
// A COLOURED MODULE COLOURS EVERY PLACEMENT OF IT, and that is deliberate: a
// Schedule copy reuses the routine's moduleId, so "Eat" carries its Physical
// colour wherever it is dropped. That is the point of colour-coding by dimension.
import { lightenHex } from "./0097-routines-match-their-dimension.mjs";

export const id = "0100-routine-colours-actually-apply";
export const describe =
  "Routine colours move to the module with styleMode:'own', where the cascade actually reads them.";

export const SUB_TINT = 0.10;
export const ACTION_TINT = 0.22;

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (id) => byId.get(id)?.label ?? modById.get(byId.get(id)?.moduleId)?.label ?? id;

  const page = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Routines";
  });
  if (!page) { log(`REFUSING: no "Routines" page — nothing written.`); return; }

  const plan = [];       // module writes
  const cleanup = [];    // occurrence-level values 0097 wrote
  for (const dimId of page.occurrences || []) {
    const dim = byId.get(dimId);
    const dimMod = modById.get(dim?.moduleId);
    const base = dimMod?.ownStyle?.bg ?? dim?.ownStyle?.bg ?? null;
    if (!dim || !base) { log(`  ${String(nameOf(dimId)).padEnd(15)} no colour of its own — skipped`); continue; }
    const subTint = lightenHex(base, SUB_TINT);
    const actTint = lightenHex(base, ACTION_TINT);
    if (!subTint || !actTint) { log(`  ${String(nameOf(dimId)).padEnd(15)} bg ${base} is not hex — skipped`); continue; }

    // Full depth, not a fixed two levels — this tree has been re-nested twice
    // and a fixed-depth walk is a bug waiting for the third (2026-08-11 (3)).
    let subs = 0, acts = 0;
    const seen = new Set();
    const stack = [...(dim.occurrences || [])];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const o = byId.get(id);
      if (!o) continue;
      const m = modById.get(o.moduleId);
      if (o.ownStyle?.bg) cleanup.push(o.id);
      if (m?.role === "container") { subs++; plan.push({ mod: m, bg: subTint }); }
      else if (m?.role === "instance") { acts++; plan.push({ mod: m, bg: actTint }); }
      for (const k of o.occurrences || []) stack.push(k);
    }
    log(`  ${String(nameOf(dimId)).padEnd(15)} ${base} -> sub ${subTint} (${subs}) · action ${actTint} (${acts})`);
  }

  // One write per module, even where a module is placed several times.
  const byMod = new Map();
  for (const p of plan) if (!byMod.has(p.mod.id)) byMod.set(p.mod.id, p);
  const writes = [...byMod.values()].filter(
    (p) => p.mod.ownStyle?.bg !== p.bg || p.mod.styleMode !== "own");
  log(`modules to write: ${writes.length} of ${byMod.size} (rest already correct)`);
  log(`occurrence-level colours from 0097 to remove: ${cleanup.length}`);

  if (dryRun) {
    log(`WOULD set ownStyle.bg + styleMode:"own" on ${writes.length} module(s) and clear ` +
      `${cleanup.length} inert occurrence value(s).`);
    return;
  }
  for (const p of writes) {
    // Write the WHOLE object — `$set: {"ownStyle.bg"}` throws when ownStyle is
    // null (0021's lesson, paid for once already).
    await Module.updateOne({ gridId, id: p.mod.id },
      { $set: { ownStyle: { ...(p.mod.ownStyle || {}), bg: p.bg }, styleMode: "own" } });
  }
  for (const id of cleanup) {
    const cur = byId.get(id)?.ownStyle || {};
    const { bg, ...rest } = cur;
    await Occurrence.updateOne({ gridId, id },
      { $set: { ownStyle: Object.keys(rest).length ? rest : null } });
  }
  log(`coloured ${writes.length} module(s); cleared ${cleanup.length} inert occurrence value(s).`);
}
