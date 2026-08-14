// server/migrations/0129-reconnect-ingredient-images.mjs
//
// User, 2026-08-14: "could you connect the images to the grocery and ingrediant
// list again."
//
// ── THE PICTURES WERE NEVER LOST — THE BINDING'S ROLE WAS WRONG ─────────────
// `0121` attached a real image artifact to all 14 plan ingredients and every one
// still resolves. What differs from the seed's own ingredients, which DO show a
// picture, is one word:
//
//     old ingredient   Poster  role:"media"   hidden:true   -> picture renders
//     plan ingredient  Poster  role:"input"   hidden:true   -> nothing renders
//
// `ModuleInstance` draws its media block from a binding whose ROLE is "media"
// (it pulls those out of the inline field row deliberately). `hidden` only
// suppresses the field ROW — so `media` + `hidden` is exactly the combination
// that shows the picture and not a line of text, which is what the seed's rows
// have always done. `0120` bound Poster as a plain input, so the artifact was
// attached to a control nothing rendered.
//
// ── AND `Total Needed` WAS NEVER ON THE BOARD, WHICH IS MY BUG ──────────────
// `0125` computed the board's show-list with `GROCERY_SHOWS.map(fid)` — but it
// CREATED the `Total Needed` field further down the same function, so at that
// point `fid("Total Needed")` was undefined and `.filter(Boolean)` silently
// dropped it. The board has been showing three fields where four were intended.
// **A field id resolved before the field is created is not an error, it is an
// absence — and `.filter(Boolean)` turns an absence into a silent one.**
export const id = "0129-reconnect-ingredient-images";
export const describe =
  "Ingredient Poster bindings are role:media so the picture renders; the grocery board shows Total Needed.";

export const GROCERY_SHOWS = ["Quantity", "Total Needed", "Price", "Poster"];

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
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  const POSTER = fid("Poster");
  if (!TAG || !POSTER) { log(`REFUSING: missing Board Category / Poster.`); return; }

  const tagsOf = (o) => { const v = o.fields?.[TAG]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const isSource = (o) => !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance";
  // Every tagged ingredient, not just the plan's — the grocery staples want
  // their pictures on the same terms.
  const targets = occs.filter((o) => isSource(o) &&
    (tagsOf(o).includes("ingredient") || tagsOf(o).includes("grocery")));

  const plan = [];
  for (const t of targets) {
    const m = modById.get(t.moduleId);
    const b = (m?.fieldBindings || []).find((x) => x.fieldId === POSTER);
    if (!b) { log(`  REFUSING "${nameOf(t)}" — no Poster binding to re-role`); continue; }
    if (b.role === "media") continue;                        // already right
    const val = t.fields?.[POSTER]?.value;
    const art = val ? byId.get(val) : null;
    plan.push({ occ: t, mod: m, hasImage: !!art, role: b.role });
  }

  const board = occs.find((o) => nameOf(o) === "Grocery List" &&
    modById.get(o.moduleId)?.role === "container");
  const showIds = GROCERY_SHOWS.map(fid);
  const missingField = GROCERY_SHOWS.filter((n, i) => !showIds[i]);
  const wantShow = showIds.filter(Boolean);
  const currentShow = board?.fieldVisibility?.fieldIds || [];
  const boardChanged = !!board &&
    (currentShow.length !== wantShow.length || currentShow.some((id, i) => id !== wantShow[i]));

  log(`ingredient rows whose Poster is not role:"media": ${plan.length}/${targets.length}`);
  for (const p of plan.slice(0, 8)) {
    log(`   ${nameOf(p.occ).padEnd(22)} role "${p.role}" -> "media"   image ${p.hasImage ? "attached" : "MISSING"}`);
  }
  if (plan.length > 8) log(`   … ${plan.length - 8} more`);
  if (missingField.length) log(`  REFUSING to list (no such field): ${missingField.join(", ")}`);
  log(`grocery board shows: ${currentShow.map((i) => fields.find((f) => f.id === i)?.name || i).join(", ") || "(unset)"}` +
    (boardChanged ? `  ->  ${GROCERY_SHOWS.filter((n, i) => showIds[i]).join(", ")}` : "  (already correct)"));
  const noImage = plan.filter((p) => !p.hasImage);
  if (noImage.length) log(`  note: ${noImage.length} row(s) carry no Poster value — re-roling gives them a slot, not a picture: ${noImage.map((p) => nameOf(p.occ)).join(", ")}`.slice(0, 260));
  if (!plan.length && !boardChanged) { log(`already connected.`); return; }
  if (dryRun) { log(`WOULD re-role ${plan.length} binding(s)${boardChanged ? " and fix the board's field list" : ""}.`); return; }

  for (const p of plan) {
    const next = (p.mod.fieldBindings || []).map((b) =>
      b.fieldId === POSTER ? { ...b, role: "media" } : b);
    await Module.updateOne({ gridId, id: p.mod.id }, { $set: { fieldBindings: next } });
  }
  if (board && boardChanged) {
    await Occurrence.updateOne({ gridId, id: board.id },
      { $set: { fieldVisibility: { mode: "show", fieldIds: wantShow } } });
  }
  log(`re-roled ${plan.length}${boardChanged ? ", board field list fixed" : ""}.`);

  const afterMods = await Module.find({ gridId }).lean();
  const am = new Map(afterMods.map((m) => [m.id, m]));
  const ok = targets.filter((t) => (am.get(t.moduleId)?.fieldBindings || [])
    .some((b) => b.fieldId === POSTER && b.role === "media")).length;
  log(`  check: ${ok}/${targets.length} ingredient rows now bind Poster as media.`);
}
