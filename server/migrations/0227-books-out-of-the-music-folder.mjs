// 0227 — Books and Authors are not music.
//
// `0226` derived its home as `exemplarPage.parentId` — the folder holding the
// Songs page. That read correctly when written and was WRONG by the time it
// ran: `0224`, applied earlier the same session, had already moved Songs into
// `Boards/Media/Music`. So the two book boards landed inside the MUSIC folder.
//
//     Root/Boards/Media/Music/  Songs · Artists · Albums · Books · Authors
//                                                          ^^^^^^^^^^^^^^^
//
// **AN EXEMPLAR'S LOCATION IS NOT A SPECIFICATION.** Copying a board's SHAPE
// from a live exemplar is right and is what kept `0226` from re-inventing the
// page/container pair. Copying its PARENT assumes the exemplar is where the new
// thing belongs, and nothing had ever said that.
//
// It mirrors the Music decision rather than restating one: music is three
// boards and got its own subfolder, so two book boards get theirs.
//
//     Root/Boards/Media/  Bookmarks · Music/{Songs,Artists,Albums} · Books/{Books,Authors}

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export const id = "0227-books-out-of-the-music-folder";
export const description = "Move the Books and Authors boards from Media/Music into their own Media/Books folder";

/** Which pages are misfiled, given where they are and where they belong. PURE. */
export function planRehome(pages, musicFolderId, booksFolderId) {
  return (pages || [])
    .filter((p) => String(p.parentId) === String(musicFolderId))
    .map((p) => ({ id: p.id, label: p.label, to: booksFolderId }));
}

export async function up({ models, gridId, dryRun, log }) {
  const { Folder, Occurrence, Module, Grid } = models;
  const gid = String(gridId);
  const grid = await Grid.findOne({ _id: gridId }).lean();

  const folders = await Folder.find({ gridId: gid }).lean();
  const media = folders.find((f) => f.name === "Media");
  if (!media) { log("no Media folder on this grid — nothing to do"); return { moved: 0 }; }
  const music = folders.find((f) => f.name === "Music" && String(f.parentId) === String(media.id));
  if (!music) { log("no Media/Music folder — nothing to do"); return { moved: 0 }; }

  const mods = new Map((await Module.find({ gridId: gid }).lean()).map((m) => [m.id, m]));
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const lbl = (o) => o.label ?? mods.get(o.moduleId)?.label ?? "";
  // By LABEL is safe here and only here: `0226` minted these two pages itself,
  // moments ago, with exactly these labels.
  const pages = occs
    .filter((o) => ["Books", "Authors"].includes(lbl(o)) && mods.get(o.moduleId)?.role === "page")
    .map((o) => ({ id: o.id, label: lbl(o), parentId: o.parentId }));

  const existing = folders.find((f) => f.name === "Books" && String(f.parentId) === String(media.id));
  const booksFolderId = existing?.id || uid();
  const moves = planRehome(pages, music.id, booksFolderId);

  if (!moves.length) { log("Books/Authors are not in the Music folder — nothing to do"); return { moved: 0 }; }
  if (!existing) log(`  ${dryRun ? "would mint" : "minting"} folder "Books" under Media`);
  for (const m of moves) log(`  ${dryRun ? "would move" : "moving"} page "${m.label}" -> Boards/Media/Books`);
  if (dryRun) return { moved: moves.length, minted: existing ? 0 : 1 };

  if (!existing) {
    await Folder.create({ id: booksFolderId, userId: grid.userId, gridId: gid, parentId: media.id,
      name: "Books", sortOrder: 1, folderType: "normal", isExpanded: true, meta: {} });
  }
  for (const m of moves) {
    await Occurrence.updateOne({ id: m.id, gridId: gid }, { $set: { parentId: booksFolderId } });
  }
  log(`moved ${moves.length} page(s) into Boards/Media/Books`);
  return { moved: moves.length, minted: existing ? 0 : 1 };
}
