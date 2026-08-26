/**
 * 0256 — the five seeded Song rows go; their artwork moves to the import first.
 *
 * User, 2026-08-26: *"forget the original seed for that"*, and when asked how
 * far to take it: **delete all five, moving the art to the twins first**.
 *
 * ── SONGS IS THE ONLY BOARD THIS AFFECTS, and that was checked ───────────
 *
 * The same question was asked of every board on the grid ("did you do books too
 * / and tv shows / and the other medias"). Measured — legacy rows are rows whose
 * module carries no `kind`, i.e. the one-off modules the 2026-07-25 seed made:
 *
 * ```
 * Songs      5,489 rows · 5 legacy · 3 of them duplicate an imported song
 * Books · Movies · TV Series · Games · Comics · Albums · Artists   0 legacy
 * ```
 *
 * The only other kind-less rows on the grid are TRACKER TILES (`Today's
 * Physical`, `Pages Read`, …) and the `Cook` routine — not media, not touched.
 *
 * ── NO ARTWORK IS DESTROYED, and that is measured rather than hoped ──────
 *
 * Each seeded row points at an image artifact through its `Poster` field. Those
 * artifacts are **not children of the row** — every one is parented to the
 * shared images folder and none is listed in the row's `occurrences[]`:
 *
 * ```
 * poster occ …  parent=da8ee488-… (the Files folder)   listedByRow=false
 * row children: (none)                                  row.occurrences: []
 * ```
 *
 * So the delete cascade cannot reach them: the pictures stay in Files whatever
 * happens here. For the three rows with an imported twin the URL is copied onto
 * the twin as `meta.cover` first, which is the key the card actually draws
 * (`0245`) — so those three songs KEEP their picture on the board.
 *
 * **Clair de Lune and Take Five have no twin and are removed with the rest**,
 * at the user's explicit instruction. Their images survive in Files; the rows do
 * not. Said plainly because it is the one irreversible part.
 *
 * Rows are dumped to `backups/orphans/` before deletion, and unlisted from the
 * board with `$pull` rather than a whole-array write.
 */
import fs from "fs";
import path from "path";

export const id = "0256-drop-seeded-songs";
export const describe =
  "Deletes the five 2026-07-25 seeded Song rows, first copying each one's artwork onto its imported twin as meta.cover. Songs is the only board with seeded leftovers; the image artifacts live in Files and are never touched.";
export const touches = ["occurrences"];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Pure. Which rows go, and where each one's picture lands. */
export function planSeededSongs({ occurrences, modules, fields }) {
  const refusals = [];
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "";
  const POSTER = fields.find((f) => f.name === "Poster")?.id;

  const boards = occurrences.filter((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "container" && m?.kind === "board" && (o.label ?? m.label) === "Songs";
  });
  if (boards.length !== 1) { refusals.push(`expected one Songs board, found ${boards.length}`); return { refusals }; }
  const board = boards[0];
  const rows = (board.occurrences || []).map((i) => occById.get(i)).filter(Boolean);
  const imported = rows.filter((r) => modById.get(r.moduleId)?.kind === "song");
  const twinByName = new Map(imported.map((r) => [norm(labelOf(r)), r]));

  const targets = [];
  for (const r of rows) {
    if (modById.get(r.moduleId)?.kind) continue;          // an imported row — never touched
    const twin = twinByName.get(norm(labelOf(r))) || null;
    const artOcc = POSTER ? occById.get(String(r.fields?.[POSTER]?.value || "")) : null;
    const artMod = artOcc ? modById.get(artOcc.moduleId) : null;
    const cover = /^https?:\/\//.test(String(artMod?.fileRef || "")) ? artMod.fileRef : null;

    // The delete must not be able to take the artwork with it.
    const artIsChild = !!artOcc && (artOcc.parentId === r.id || (r.occurrences || []).includes(artOcc.id));
    if (artIsChild) refusals.push(`"${labelOf(r)}" owns its poster as a child — deleting the row would cascade onto the artwork`);

    targets.push({
      id: r.id, label: labelOf(r), boardId: board.id,
      twinId: twin?.id || null,
      cover: twin && cover ? cover : null,
      hasChildren: occurrences.some((o) => o.parentId === r.id),
    });
  }
  for (const t of targets) if (t.hasChildren) refusals.push(`"${t.label}" has children — refusing to cascade`);
  return { refusals, targets, importedCount: imported.length };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occurrences, modules, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const p = planSeededSongs({ occurrences, modules, fields });
  if (p.refusals.length) { for (const r of p.refusals) log(`  REFUSING — ${r}`); return; }
  if (!p.targets.length) { log("no seeded Song rows left — nothing to do."); return; }

  log(`Songs board: ${p.importedCount} imported rows kept; ${p.targets.length} seeded rows to remove`);
  for (const t of p.targets) {
    log(`  "${t.label}" — ${t.cover ? `artwork -> twin ${t.twinId}` : t.twinId ? "twin has no usable artwork URL" : "NO twin (row goes, its image stays in Files)"}`);
  }
  if (dryRun) { log("DRY RUN — nothing written."); return; }

  const dir = path.resolve(process.cwd(), "backups/orphans");
  fs.mkdirSync(dir, { recursive: true });
  const doomed = occurrences.filter((o) => p.targets.some((t) => t.id === o.id));
  const dump = path.join(dir, `0256-seeded-songs-${Date.now()}.json`);
  fs.writeFileSync(dump, JSON.stringify(doomed, null, 2));
  log(`dumped ${doomed.length} raw row(s) to ${dump}`);

  let moved = 0;
  for (const t of p.targets) {
    if (t.cover) { await Occurrence.updateOne({ gridId, id: t.twinId }, { $set: { "meta.cover": t.cover } }); moved++; }
  }
  log(`moved ${moved} cover(s) onto the imported twin.`);

  const ids = p.targets.map((t) => t.id);
  for (const t of p.targets) {
    await Occurrence.updateOne({ gridId, id: t.boardId }, { $pull: { occurrences: t.id } });
  }
  await Occurrence.deleteMany({ gridId, id: { $in: ids } });
  log(`removed ${ids.length} seeded row(s); the image artifacts in Files are untouched.`);
}
