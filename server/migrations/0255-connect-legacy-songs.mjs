/**
 * 0255 — the five seeded songs get their Artist and Album.
 *
 * User, 2026-08-26: *"songs should be connected to albumn and artist"*.
 *
 * ── THE 5,484 IMPORTED SONGS ALREADY ARE ────────────────────────────────
 *
 * Measured before changing anything — every edge resolves, nothing dangles:
 * ```
 * song -> Album   5,484 / 5,484 set · 0 dangling
 * song -> Artist  5,294 / 5,484 set · 0 dangling
 * ```
 * and a sample dereferences cleanly: `"Cosmic Joe"` -> `"Vision Songs, Vol.1"`
 * -> `"Laraaji"`. The dropdown predicate matches them too.
 *
 * ── WHAT IS ACTUALLY WRONG IS THE TOP OF THE BOARD ──────────────────────
 *
 * The Songs board holds **5,489** rows: the 5,484 imported ones plus **five
 * from the original 2026-07-25 seed**, and those five SORT FIRST. They are
 * one-off modules — one per song — whose only bindings are
 * `Board Category(h)`, `Poster(h)`, `Files(h)`, every one HIDDEN. So the first
 * thing on screen is five songs with no fields at all, which is exactly what
 * "songs should be connected to album and artist" describes.
 *
 * Verified in a browser rather than inferred: the first three rows render with
 * **zero field pills**.
 *
 * ── AND THREE OF THEM ALREADY HAVE A TWIN THAT KNOWS THE ANSWER ─────────
 *
 * ```
 * Hallelujah     duplicate of an imported song  -> copy its Artist + Album
 * Blackbird      duplicate                      -> copy
 * Redbone        duplicate                      -> copy
 * Clair de Lune  NOT a duplicate                -> bindings only, values left empty
 * Take Five      NOT a duplicate                -> bindings only
 * ```
 *
 * ── NOTHING IS DELETED, AND THAT IS DELIBERATE ──────────────────────────
 *
 * The obvious tidy-up is to drop the three duplicates. They are NOT dropped:
 * each carries a `Poster` + `Files` artifact — real artwork the imported rows do
 * not have (these five are the only songs on the grid with a picture) — and
 * deleting the row runs the child cascade over that artifact. Adding two
 * bindings answers the ask without putting a single existing thing at risk;
 * merging the duplicates is a separate, destructive decision that is the user's.
 *
 * Idempotent: a module that already binds Artist/Album is skipped, and a value
 * is only written where the row has none.
 */

export const id = "0255-connect-legacy-songs";
export const describe =
  "Gives the five seeded Song rows visible Artist + Album bindings, and copies those values from their imported twin where one exists. Deletes nothing — the seeded rows carry the only song artwork on the grid.";
export const touches = ["modules", "occurrences"];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Pure. Which legacy song rows need what. */
export function planLegacySongs({ occurrences, modules, fields }) {
  const refusals = [];
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "";
  const fid = (n) => fields.find((f) => f.name === n && f.type === "occurrence")?.id;
  const ARTIST = fid("Artist"), ALBUM = fid("Album");
  if (!ARTIST || !ALBUM) { refusals.push("no occurrence-typed Artist/Album field"); return { refusals }; }

  const boards = occurrences.filter((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "container" && m?.kind === "board" && (o.label ?? m.label) === "Songs";
  });
  if (boards.length !== 1) { refusals.push(`expected one Songs board, found ${boards.length}`); return { refusals }; }
  const rows = (boards[0].occurrences || []).map((i) => occById.get(i)).filter(Boolean);

  const imported = rows.filter((r) => modById.get(r.moduleId)?.kind === "song");
  const legacy = rows.filter((r) => !modById.get(r.moduleId)?.kind);
  const twinByName = new Map(imported.map((r) => [norm(labelOf(r)), r]));

  const targets = legacy.map((r) => {
    const mod = modById.get(r.moduleId);
    const bound = new Set((mod?.fieldBindings || []).map((b) => b.fieldId));
    const twin = twinByName.get(norm(labelOf(r))) || null;
    return {
      occId: r.id, moduleId: r.moduleId, label: labelOf(r),
      needsBindings: !bound.has(ARTIST) || !bound.has(ALBUM),
      twinId: twin?.id || null,
      artist: twin && !r.fields?.[ARTIST]?.value ? twin.fields?.[ARTIST]?.value ?? null : null,
      album: twin && !r.fields?.[ALBUM]?.value ? twin.fields?.[ALBUM]?.value ?? null : null,
    };
  });
  return { refusals, ARTIST, ALBUM, importedCount: imported.length, targets };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occurrences, modules, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const p = planLegacySongs({ occurrences, modules, fields });
  if (p.refusals.length) { for (const r of p.refusals) log(`  REFUSING — ${r}`); return; }

  log(`Songs board: ${p.importedCount} imported (already connected) + ${p.targets.length} seeded`);
  let bound = 0, filled = 0;
  for (const t of p.targets) {
    const bits = [];
    if (t.needsBindings) bits.push("bind Artist+Album");
    if (t.artist || t.album) bits.push(`copy from twin (${[t.artist && "Artist", t.album && "Album"].filter(Boolean).join("+")})`);
    log(`  "${t.label}"  ${bits.join(" · ") || "already connected"}${t.twinId ? "" : "  [no imported twin — values left for the user]"}`);
    if (dryRun) continue;

    if (t.needsBindings) {
      const mod = modules.find((m) => m.id === t.moduleId);
      const have = new Set((mod.fieldBindings || []).map((b) => b.fieldId));
      const next = [...(mod.fieldBindings || [])];
      // VISIBLE — the whole complaint is that this row shows no fields.
      if (!have.has(p.ARTIST)) next.push({ fieldId: p.ARTIST, order: 1, role: "input" });
      if (!have.has(p.ALBUM)) next.push({ fieldId: p.ALBUM, order: 2, role: "input" });
      await Module.updateOne({ gridId, id: t.moduleId }, { $set: { fieldBindings: next } });
      bound++;
    }
    const set = {};
    if (t.artist) set[`fields.${p.ARTIST}`] = { value: t.artist, flow: "in" };
    if (t.album) set[`fields.${p.ALBUM}`] = { value: t.album, flow: "in" };
    if (Object.keys(set).length) { await Occurrence.updateOne({ gridId, id: t.occId }, { $set: set }); filled++; }
  }
  log(`\nplan: ${bound} module(s) gained bindings, ${filled} row(s) filled from a twin`);
  if (dryRun) log("DRY RUN — nothing written.");
}
