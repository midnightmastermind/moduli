// server/migrations/0097-routines-match-their-dimension.mjs
//
// User, 2026-08-13: "give the matching color to each routine based on its
// container in the routines."
//
// THE PALETTE ALREADY EXISTS AND ONLY THE TOP LEVEL WEARS IT. Measured on the
// Routines page: the nine DIMENSION containers each carry an `ownStyle.bg` (the
// vintage palette 0020/0021 seeded — Physical #b34f24, Emotional #7d3049,
// Intellectual #4a3b52, Social #e08b31 …), while every sub-category container
// and every action instance beneath them is `bg: null`. So a routine gives no
// clue which dimension it belongs to once you are looking at it.
//
// THE ACTION IS TINTED, NOT PAINTED THE SAME COLOUR, and that is the one real
// decision here. An action sitting inside its dimension container at the
// IDENTICAL background disappears into it — the exact complaint 2026-07-31
// records about artifact cards ("it just blends with the background"). Lightening
// the dimension's own hue keeps the match obvious while leaving the row legible
// as its own object.
//
// SUB-CONTAINERS ARE LEFT TRANSPARENT ON PURPOSE. Dimension (strong) →
// sub-category (transparent) → action (tint) is a readable three-step hierarchy;
// colouring the middle level too would flatten it into one block of colour.
//
// ONLY UNSET BACKGROUNDS ARE WRITTEN. A routine someone has already coloured by
// hand is theirs, and skipping non-null values is also what makes a re-run a
// no-op rather than an accumulation.

/** Blend a hex colour toward white. Mirrors the client's colorHelpers.lightenHex. */
export function lightenHex(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export const id = "0097-routines-match-their-dimension";
export const describe =
  "Every routine takes a tint of its dimension's colour, so which dimension it belongs to reads at a glance.";

export const TINT = 0.18;

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (id) => byId.get(id)?.label ?? modById.get(byId.get(id)?.moduleId)?.label ?? id;
  const bgOf = (o) => o?.ownStyle?.bg ?? modById.get(o?.moduleId)?.ownStyle?.bg ?? null;

  const page = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Routines";
  });
  if (!page) { log(`REFUSING: no "Routines" page — nothing written.`); return; }

  // Every ACTION under a dimension, at any depth — the tree is
  // dimension → sub-category → action today, but a fixed-depth walk is a bug
  // waiting for the next re-nesting (2026-08-11 (3) records exactly that).
  const actionsUnder = (rootId) => {
    const out = [];
    const seen = new Set();
    const stack = [...(byId.get(rootId)?.occurrences || [])];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const o = byId.get(id);
      if (!o) continue;
      if (modById.get(o.moduleId)?.role === "instance") out.push(o);
      for (const k of o.occurrences || []) stack.push(k);
    }
    return out;
  };

  const plan = [];
  let already = 0;
  for (const dimId of page.occurrences || []) {
    const dim = byId.get(dimId);
    const dimBg = bgOf(dim);
    if (!dim) continue;
    if (!dimBg) { log(`  ${String(nameOf(dimId)).padEnd(16)} no colour of its own — skipped`); continue; }
    const tint = lightenHex(dimBg, TINT);
    if (!tint) { log(`  ${String(nameOf(dimId)).padEnd(16)} bg ${dimBg} is not a hex colour — skipped`); continue; }
    const actions = actionsUnder(dimId);
    const todo = actions.filter((a) => !bgOf(a));
    already += actions.length - todo.length;
    log(`  ${String(nameOf(dimId)).padEnd(16)} ${dimBg} -> ${tint}   ${todo.length} routine(s) of ${actions.length}`);
    for (const a of todo) plan.push({ id: a.id, tint });
  }
  log(`total: ${plan.length} routine(s) to colour, ${already} already carry one (left alone)`);

  if (dryRun) {
    log(`WOULD set ownStyle.bg on ${plan.length} routine(s) to a ${Math.round(TINT * 100)}% tint of their dimension.`);
    return;
  }
  for (const p of plan) {
    // Write the WHOLE object: `$set: {"ownStyle.bg": …}` throws when ownStyle is
    // null ("Cannot create field 'bg' in element {ownStyle: null}") — 0021's
    // lesson, paid for once already.
    const cur = byId.get(p.id)?.ownStyle || {};
    await Occurrence.updateOne({ gridId, id: p.id }, { $set: { ownStyle: { ...cur, bg: p.tint } } });
  }
  log(`coloured ${plan.length} routine(s).`);
}
