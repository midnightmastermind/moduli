// server/migrations/0130-ingredient-thumbnails-inline.mjs
//
// User, 2026-08-14: "why isnt it showing the instance image with the artifact
// viewer popping up when i click it. it was to the left of the label before."
//
// `0129` gave the Poster binding `role: "media"`, which is what makes a picture
// render at all — but `ModuleInstance` has TWO media shapes, and it picked the
// wrong one by default:
//
//     meta.mediaInline UNSET  ->  a full-width block UNDER the label and fields
//     meta.mediaInline true   ->  a 22px thumbnail beside the LABEL
//
// The seed's own ingredients carry `mediaInline: true` (15 of 16), as do 205
// rows across the grid — movies, books, people. The plan's ingredients, minted
// by `0103`, never got it, so they rendered the poster-sized block instead of
// the small thumb the user remembers. **A block per row is exactly what the
// inline mode exists to avoid**: ModuleInstance's own comment says a
// poster-sized block per option "made the boards unreadable".
//
// Set on the MODULE, matching the seed — an occurrence-level flag would apply to
// one placement, and these rows are also materialised as feed copies on the
// board, which read their module.
//
// (The click that opens the artifact viewer is the client half of this, in
// `ModuleInstance`: the inline thumb had no handler at all, so the full image
// was unreachable on any row whose media binding is hidden.)
export const id = "0130-ingredient-thumbnails-inline";
export const describe = "Ingredient pictures render as an inline thumbnail beside the label, not a block.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  const POSTER = fields.find((f) => f.name === "Poster" && !f.displayEnabled)?.id;
  if (!TAG || !POSTER) { log(`REFUSING: missing Board Category / Poster.`); return; }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";

  const seen = new Map();
  for (const o of occs) {
    if (!isSource(o)) continue;
    const t = tagsOf(o);
    if (!t.includes("ingredient") && !t.includes("grocery")) continue;
    const m = modById.get(o.moduleId);
    if (!m || m.meta?.mediaInline === true) continue;
    // Only rows that can actually SHOW something — a media binding. Setting the
    // flag on a row with no picture changes nothing and muddies the count.
    if (!(m.fieldBindings || []).some((b) => b.fieldId === POSTER && b.role === "media")) {
      log(`  skipping "${nameOf(o)}" — Poster is not bound as media`);
      continue;
    }
    if (!seen.has(m.id)) seen.set(m.id, nameOf(o));
  }

  // How the rest of the grid already does it — the number that says this is the
  // convention rather than a preference.
  const already = mods.filter((m) => m.meta?.mediaInline === true).length;
  log(`modules already inline across the grid: ${already}`);
  log(`ingredient modules to switch: ${seen.size}`);
  [...seen.values()].slice(0, 10).forEach((n) => log(`   ${n}`));
  if (seen.size > 10) log(`   … ${seen.size - 10} more`);
  if (!seen.size) { log(`every ingredient already renders inline.`); return; }
  if (dryRun) { log(`WOULD set meta.mediaInline on ${seen.size} module(s).`); return; }

  await Module.updateMany(
    { gridId, id: { $in: [...seen.keys()] } },
    { $set: { "meta.mediaInline": true } },
  );
  const after = await Module.find({ gridId, "meta.mediaInline": true }).lean();
  log(`set on ${seen.size}; ${after.length} module(s) now render media inline.`);
}
