// server/migrations/0102-dim-routines-and-schedule-copies.mjs
//
// User, 2026-08-13: "you need to change the ones in schedule (the routine
// instances), to the colors you just did" / "its just slightly too bright,
// forget about changing the text color. just dim down the instances brightness"
// / "for routines".
//
// WHY THE SCHEDULE COPIES MISSED OUT. 0100 coloured the routine MODULES, and a
// module's colour follows every placement of it — but `Schedule: Build Schedule`
// clones its routines through APPLY_TEMPLATE, which mints NEW modules. The
// copies are therefore different modules with the same labels (six "Eat"
// modules, seven "Exercise" …), so they inherited nothing.
//
// MATCHED BY LABEL, WHICH IS NORMALLY A GUESS — 2026-08-07 records title
// matching being wrong on real data every single time. It is safe HERE only
// because the check was run first: every label that matches a routine maps to
// exactly ONE routine colour, zero ambiguous. That check is in the migration, and
// it REFUSES rather than guessing if a label ever maps to two colours.
//
// AND THE INSTANCES ARE DIMMED. 0100 put actions 22% toward white, which reads
// too bright against the container. They are now DARKER than their dimension
// instead of lighter — dimmer, and still clearly distinct from the container
// behind them, which is what a same-colour tint could never be:
//
//   dimension      the palette colour       (unchanged)
//   sub-container  8% toward white          (a hair lighter)
//   action        15% toward black          (dimmed)
import { lightenHex } from "./0097-routines-match-their-dimension.mjs";

export const id = "0102-dim-routines-and-schedule-copies";
export const describe =
  "Routine instances are dimmed, and the Schedule's cloned copies take their routine's colour.";

export const SUB_TINT = 0.08;
export const ACTION_DARKEN = 0.15;

/** Blend a hex colour toward black. */
export function darkenHex(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.round(c * (1 - amount));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

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

  // Walk each dimension at full depth and recompute the ladder.
  const writes = [];
  const routineColour = new Map();   // label -> action colour
  for (const dimId of page.occurrences || []) {
    const dim = byId.get(dimId);
    const dimMod = modById.get(dim?.moduleId);
    const base = dimMod?.ownStyle?.bg ?? null;
    if (!dim || !base) continue;
    const subBg = lightenHex(base, SUB_TINT);
    const actBg = darkenHex(base, ACTION_DARKEN);
    if (!subBg || !actBg) { log(`  ${nameOf(dimId)}: ${base} is not hex — skipped`); continue; }

    const seen = new Set();
    const stack = [...(dim.occurrences || [])];
    let subs = 0, acts = 0;
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const o = byId.get(id);
      if (!o) continue;
      const m = modById.get(o.moduleId);
      if (m?.role === "container") { subs++; writes.push({ mod: m, bg: subBg }); }
      else if (m?.role === "instance") {
        acts++;
        writes.push({ mod: m, bg: actBg });
        routineColour.set((m.label || "").trim().toLowerCase(), actBg);
      }
      for (const k of o.occurrences || []) stack.push(k);
    }
    log(`  ${String(nameOf(dimId)).padEnd(15)} ${base} -> sub ${subBg} (${subs}) · action ${actBg} (${acts})`);
  }

  // THE SCHEDULE'S CLONES. Refuse rather than guess if a label is ambiguous.
  const ambiguous = [];
  for (const [label] of routineColour) {
    const colours = new Set(mods
      .filter((m) => m.role === "instance" && (m.label || "").trim().toLowerCase() === label
        && routineColour.has((m.label || "").trim().toLowerCase()))
      .map((m) => routineColour.get(label)));
    if (colours.size > 1) ambiguous.push(label);
  }
  if (ambiguous.length) {
    log(`REFUSING: these labels map to more than one routine colour — ${ambiguous.join(", ")}`);
    return;
  }
  const routineModIds = new Set(writes.map((w) => w.mod.id));
  const copies = mods.filter((m) =>
    m.role === "instance" && !routineModIds.has(m.id)
    && routineColour.has((m.label || "").trim().toLowerCase()));
  const byLabel = new Map();
  for (const c of copies) {
    const k = (c.label || "").trim().toLowerCase();
    byLabel.set(k, (byLabel.get(k) || 0) + 1);
    writes.push({ mod: c, bg: routineColour.get(k) });
  }
  log(`schedule/other copies matched by label: ${copies.length}`);
  for (const [k, n] of byLabel) log(`   ${String(k).padEnd(14)} ${n} copy(ies) -> ${routineColour.get(k)}`);

  const changed = writes.filter((w) => w.mod.ownStyle?.bg !== w.bg || w.mod.styleMode !== "own");
  log(`modules to write: ${changed.length} of ${writes.length}`);

  if (dryRun) {
    log(`WOULD dim ${writes.length - copies.length} routine module(s) and colour ${copies.length} copy(ies).`);
    return;
  }
  for (const w of changed) {
    await Module.updateOne({ gridId, id: w.mod.id },
      { $set: { ownStyle: { ...(w.mod.ownStyle || {}), bg: w.bg }, styleMode: "own" } });
  }
  log(`wrote ${changed.length} module colour(s).`);
}
