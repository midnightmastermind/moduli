// 0216 — `0215` gave the four nested tracker groups a BORDER and no FILL.
//
// Found by rendering the page rather than by reading the diff. After `0215` they
// carry the same 1px border as every other group and `background:
// rgba(0,0,0,0)` — while `Today's Physical`, `Today's Social` and the rest each
// carry a 0.24 tint. Half a box is not "boxes like the rest".
//
// **THE FLAG WAS NECESSARY AND NOT SUFFICIENT.** `ModuleContainer` computes
// `rawColor = embedded ? (module.ownStyle?.bg || null) : null`, so a container
// needs BOTH the opt-in AND a colour; with no `ownStyle.bg` it falls through to
// `var(--doc-container-tint)`, which is transparent under this skin. Their nine
// siblings all carry a stored colour — that is where the tint comes from.
//
// **THE COLOUR IS DERIVED, NEVER PICKED.** Each group takes its PARENT
// dimension's colour: Workout and Nutrition inherit Physical's orange, Media
// inherits Intellectual's purple, Planning inherits Occupational's olive. A
// hand-chosen palette here would drift the moment a dimension is re-tinted, and
// the point of the ask is that a nested group should read as part of its
// dimension.
//
// Both paint at the same 0.24 alpha, so a nested box composites to ~0.42 over its
// parent — visibly a box inside a box, which is the intent. That is well under
// the three-nested-opaque-fills problem 2026-08-19 (2) records, where the alpha
// was the surface alpha rather than the stored-colour one.
//
// A group that already carries its own colour is LEFT ALONE — someone chose it.

export const id = "0216-nested-tracker-groups-take-their-dimension-colour";
export const description =
  "The four nested tracker groups had a border and no fill — they take their parent dimension's colour";

/** Pick the colour a nested group should paint. PURE. */
export function colourFor(groupMod, parentMod) {
  if (groupMod?.ownStyle?.bg) return null;          // already chosen — never overwrite
  const bg = parentMod?.ownStyle?.bg;
  return typeof bg === "string" && bg ? bg : null;  // no parent colour: nothing to inherit
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const occs = await Occurrence.find({ gridId }).lean();
  const occById = new Map(occs.map((o) => [o.id, o]));
  const mods = await Module.find({ gridId }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));

  // The same population `0215` flagged — read from the FLAG rather than
  // re-deriving it, so the two migrations cannot disagree about which four.
  const flagged = mods.filter((m) => m.meta?.cardChrome === true);
  log(`  ${flagged.length} container(s) carry meta.cardChrome`);

  const parentOf = new Map();
  for (const p of occs) for (const c of p.occurrences || []) if (!parentOf.has(c)) parentOf.set(c, p.id);

  const ops = [];
  for (const m of flagged) {
    const occ = occs.find((o) => o.moduleId === m.id);
    const parentMod = occ && modById.get(occById.get(parentOf.get(occ.id))?.moduleId);
    const colour = colourFor(m, parentMod);
    if (!colour) { log(`    ${(m.label || "?").padEnd(14)} skipped (has its own colour, or its parent has none)`); continue; }
    log(`    ${(m.label || "?").padEnd(14)} <- ${parentMod?.label} ${colour}`);
    // THE WHOLE OBJECT, not the dotted path — and this migration failed once by
    // getting it backwards. `$set: { "ownStyle.bg": … }` throws
    // "Cannot create field 'bg' in element {ownStyle: null}" when `ownStyle` is
    // null, which is exactly what all four carry. 2026-07-31 (2) records this;
    // the runner failing closed is what caught it a second time.
    ops.push({ updateOne: { filter: { id: m.id, gridId },
                            update: { $set: { ownStyle: { ...(m.ownStyle || {}), bg: colour } } } } });
  }
  log(`${dryRun ? "[dry run] " : ""}${ops.length} nested group(s) take their dimension's colour`);
  if (!dryRun && ops.length) await Module.bulkWrite(ops, { ordered: false });
  return { coloured: ops.length };
}
