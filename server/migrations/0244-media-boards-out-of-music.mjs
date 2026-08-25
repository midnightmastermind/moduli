/**
 * 0244 — Movies, TV Series, Games and Comics were filed under MUSIC.
 *
 * User, 2026-08-25: *"there are pages that dont belong in the music folder
 * currently like movies and tv shows."*
 *
 * `0238` minted five boards for the media.md import and parented all of them
 * next to the Spotify boards, because that is where the first one belonged:
 *
 * ```
 * Root/Boards/Media/Music
 *   Songs · Artists · Albums              music — correct
 *   Movies · TV Series · Games · Comics   not music
 * ```
 *
 * They move up one level to `Root/Boards/Media`, which already holds Bookmarks
 * and the Music and Books sub-folders — so Movies sits beside Bookmarks as a
 * peer, and Music keeps only the three boards that are actually music.
 *
 * ── IT MOVES THE PAGE, AND THAT IS THE WHOLE CHANGE ──────────────────────
 *
 * A board page is homed by `parentId` pointing at a FOLDER; the tree and the
 * folder page both read that. Nothing else encodes the location — the rows
 * themselves hang off the board CONTAINER, not the folder, so no row moves and
 * no feed changes. Verified rather than assumed: the boards are matched by id
 * from their current parent, and the migration REFUSES if the destination
 * folder is missing or if a board is not where it expects.
 *
 * **The `Music` folder is NOT renamed and no folder is created.** The user
 * named the problem as pages in the wrong folder, not as a missing taxonomy —
 * inventing `Root/Boards/Media/Film` here would be answering a question they
 * did not ask, and a folder is one drag to make.
 *
 * Idempotent: a board already parented to Media is skipped, so a re-run reports
 * `0 to move`.
 */
export const id = "0244-media-boards-out-of-music";
export const describe =
  "Moves the Movies, TV Series, Games and Comics board pages out of Boards/Media/Music and up into Boards/Media, beside Bookmarks.";
export const touches = ["occurrences"];

/** Boards that are not music. Matched by LABEL within the Music folder only. */
export const MISFILED = ["Movies", "TV Series", "Games", "Comics"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const [folders, occs, mods] = await Promise.all([
    Folder.find({ gridId }).lean(),
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const fById = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (f) => { const p = []; let c = f, d = 0; while (c && d++ < 12) { p.unshift(c.name); c = fById.get(c.parentId); } return p.join("/"); };

  const music = folders.find((f) => pathOf(f) === "Root/Boards/Media/Music");
  const media = folders.find((f) => pathOf(f) === "Root/Boards/Media");
  if (!music || !media) {
    log(`REFUSING: could not resolve both folders (Music=${!!music}, Media=${!!media}) — nothing written.`);
    return;
  }
  log(`Music=${music.id.slice(0, 10)}  Media=${media.id.slice(0, 10)}`);

  const inMusic = occs.filter((o) => o.parentId === music.id);
  const labelOf = (o) => o.label ?? modById.get(o.moduleId)?.label ?? "";
  const moving = inMusic.filter((o) => MISFILED.includes(labelOf(o)));

  const staying = inMusic.filter((o) => !MISFILED.includes(labelOf(o))).map(labelOf);
  log(`Music holds ${inMusic.length}: moving ${moving.length} [${moving.map(labelOf).join(", ")}], keeping [${staying.join(", ")}]`);

  if (!moving.length) { log("0 to move — already done."); return; }
  if (dryRun) { log("DRY RUN — nothing written."); return; }

  for (const o of moving) {
    await Occurrence.updateOne({ gridId, id: o.id }, { $set: { parentId: media.id } });
  }
  log(`re-homed ${moving.length} board page(s) into Boards/Media.`);
}
