// 0224 — Media becomes a FOLDER of boards, and the Codex gets a Documents home.
//
// User, 2026-08-24, after finding neither in the tree: *"there should be a
// documents folder with the codex inside and the bookmarks should be in a board
// in the boards folder"*, then *"media is going to get too big so that should be
// a folder with music and bookmarks in it"* — *"instead of a board container
// with all the media types inside"*.
//
//     Root/Boards/Media/            NEW, an 8th life-area beside Creative..Home
//       Music/                      NEW — music is THREE boards, not one
//         Songs · Albums · Artists  moved out of Boards/Creative
//       Bookmarks                   moved out of Root/Bookmarks
//     Root/Documents/               NEW, top-level
//       Codex/                      moved out of Root/Codex
//       Notes/                      moved out of Root/Notes  (+ its Health/)
//
// ── "A COUPLE I CANT FIND ANYMORE" — NOTHING IS MISSING ───────────────────
//
// User: *"ik we had a couple that i cant find anymore"* / *"one was a page on
// the philosophers stone"*. It is in `Root/Notes`, first row, and measured
// through `decompressTextmap` rather than a raw read (textmaps are stored
// COMPRESSED, and a raw scan reports "no text" for every page — the `0032`
// rule): **2,063 characters and 21 children.** All eleven are intact:
//
//     Philosopher's Stone 2063 · Gospel of Thomas (Text) 11299 · Uses 3324
//     Pragmatic 1966 · AI Specs 1675 · Bangle Specs 1287 · Gospel (Notes) 899
//     Comparative Religion 220 · Health/{Nutrition,Fitness,Basic Nutrition} 113 ea
//
// They were never lost — they were in a folder the user was not looking in.
// The whole `Notes` FOLDER moves, carrying `Health/` with it, rather than
// eleven separate page moves: one move, reversible, and the Health grouping
// survives.
//
// ── WHAT DELIBERATELY DOES NOT MOVE, AND ONE OF THEM IS A TRAP ────────────
//
// `Root/Templates` holds `Project: {ProjectName}` and `Day Page` as doc pages.
// **A template is identified by its LOCATION** (`utils/templatesFolder.js` —
// "location is the marker", 2026-08-03), so filing them under Documents would
// silently stop them being templates. They stay.
//
// `Root/Imports/Eminem` is an imported article rather than a note the user
// wrote, and `Imports` is a landing zone with its own meaning. Reported, not
// moved — the user named neither.
//
// ── NOTHING WAS BROKEN, WHICH IS WHY THIS IS A MOVE AND NOT A REPAIR ──────
//
// Measured before writing anything: `Root/Bookmarks` holds a page whose board
// lists 1,467 rows, all parented; `Root/Codex` holds 8 subfolders and 75 pages;
// and all three music boards are the healthy PAIR shape (a `page/board` in
// `Boards/Creative` listing a `container/board` whose own parentId is null —
// NOT the unreachable-board defect that shape resembles, checked explicitly
// because `0158` shipped exactly that bug). So every id already resolves. What
// was wrong is only WHERE they sit, and the fix is `parentId` on FOLDERS.
//
// ── IT MOVES FOLDERS AND PAGES, NEVER THE 8,428 ROWS ──────────────────────
//
// A board's rows are parented to the board CONTAINER, and the container is
// listed by its page. Re-homing the PAGE carries the whole board with it, so
// this migration touches 6 pages and 2 folders — never a row. That is the
// difference between a structural move and a data migration, and it is why
// this cannot strand a song.
//
// ── THE MUSIC BOARDS ARE FOUND BY THEIR FEED TAG, NOT BY LABEL ────────────
//
// `Songs`/`Albums`/`Artists` are ordinary words and this grid carries
// duplicate labels. The board containers are identified by the `Board Category`
// value their own feed filters on (`song`/`album`/`artist`) — the same key
// `0221` used to mint them — and the PAGE is then the occurrence that LISTS
// that container. Resolving the page by name would have been a guess.

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export const id = "0224-media-folder-and-documents";
export const description = "Media folder (Music + Bookmarks) under Boards, and a top-level Documents folder holding Codex";

/** Where each thing should end up. PURE, so the whole plan is testable without
 *  a database and a wrong destination fails a test rather than moving a page. */
export function planMoves({ musicPages, bookmarksPage, codexFolder, notesFolder, ids }) {
  const moves = [];
  for (const p of musicPages || []) moves.push({ kind: "page", what: p.label, id: p.id, to: ids.musicFolder, toName: "Boards/Media/Music" });
  if (bookmarksPage) moves.push({ kind: "page", what: "Bookmarks", id: bookmarksPage.id, to: ids.mediaFolder, toName: "Boards/Media" });
  if (codexFolder) moves.push({ kind: "folder", what: "Codex", id: codexFolder.id, to: ids.documentsFolder, toName: "Documents" });
  // The FOLDER, not its eleven pages — `Health/` rides along and one move undoes it.
  if (notesFolder) moves.push({ kind: "folder", what: "Notes", id: notesFolder.id, to: ids.documentsFolder, toName: "Documents" });
  return moves;
}

export async function up({ models, gridId, dryRun, log }) {
  const { Module, Occurrence, Folder, Field, Grid } = models;
  const gid = String(gridId);
  const grid = await Grid.findOne({ _id: gridId }).lean();

  const folders = await Folder.find({ gridId: gid }).lean();
  const byName = (n) => folders.find((f) => f.name === n);
  const boards = byName("Boards");
  const root = folders.find((f) => !f.parentId && f.name === "Root");
  if (!boards || !root) { log("no Boards/Root folder on this grid — nothing to do"); return { moved: 0 }; }

  const mods = new Map((await Module.find({ gridId: gid }).lean()).map((m) => [m.id, m]));
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const occById = new Map(occs.map((o) => [o.id, o]));
  const lbl = (o) => o?.label ?? mods.get(o?.moduleId)?.label ?? "(untitled)";

  // --- the music boards, by their FEED TAG rather than by label -----------
  const tagField = await Field.findOne({ gridId: gid, name: "Board Category" }).lean();
  const tagOf = (o) => { const v = tagField && o.fields?.[tagField.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const musicPages = [];
  for (const tag of ["song", "album", "artist"]) {
    const container = occs.find((o) => o.feed?.enabled && tagOf(o).includes(tag));
    if (!container) { log(`  ! no ${tag} board container — skipped`); continue; }
    const page = occs.find((o) => (o.occurrences || []).includes(container.id));
    if (!page) { log(`  ! ${tag} container ${container.id} is listed by NOTHING — skipped, and that is its own defect`); continue; }
    musicPages.push({ id: page.id, label: lbl(page) });
  }

  // --- the bookmarks board page ------------------------------------------
  const bmFolder = byName("Bookmarks");
  let bookmarksPage = null;
  if (bmFolder) {
    const pages = occs.filter((o) => String(o.parentId) === String(bmFolder.id));
    bookmarksPage = pages.find((o) => mods.get(o.moduleId)?.kind === "board") || null;
    if (!bookmarksPage) log(`  ! Bookmarks folder holds no board page (${pages.length} page(s)) — skipped`);
  }
  const codexFolder = byName("Codex");
  // Only the Notes folder that sits at the ROOT — `byName` would happily return
  // a `Notes` nested anywhere, and this grid carries repeated folder names.
  const notesFolder = folders.find((f) => f.name === "Notes" && String(f.parentId) === String(root.id));

  // --- destinations: reuse an existing folder, never mint a second --------
  const existingMedia = folders.find((f) => f.name === "Media" && String(f.parentId) === String(boards.id));
  const existingDocs = folders.find((f) => f.name === "Documents" && String(f.parentId) === String(root.id));
  const existingMusic = existingMedia && folders.find((f) => f.name === "Music" && String(f.parentId) === String(existingMedia.id));

  const ids = {
    mediaFolder: existingMedia?.id || uid(),
    musicFolder: existingMusic?.id || uid(),
    documentsFolder: existingDocs?.id || uid(),
  };
  const mint = [];
  // sortOrder 10 puts Media after Home (9); Documents after Files (50).
  if (!existingMedia) mint.push({ id: ids.mediaFolder, name: "Media", parentId: boards.id, sortOrder: 10 });
  if (!existingMusic) mint.push({ id: ids.musicFolder, name: "Music", parentId: ids.mediaFolder, sortOrder: 0 });
  if (!existingDocs) mint.push({ id: ids.documentsFolder, name: "Documents", parentId: root.id, sortOrder: 51 });

  const planned = planMoves({ musicPages, bookmarksPage, codexFolder, notesFolder, ids });
  // Already where it belongs -> not a move. This is the idempotency.
  const moves = planned.filter((m) => {
    const cur = m.kind === "folder"
      ? folders.find((f) => String(f.id) === String(m.id))?.parentId
      : occById.get(m.id)?.parentId;
    return String(cur) !== String(m.to);
  });

  for (const f of mint) log(`  ${dryRun ? "would mint" : "minting"} folder "${f.name}" under ${f.parentId}`);
  for (const m of moves) log(`  ${dryRun ? "would move" : "moving"} ${m.kind} "${m.what}" -> ${m.toName}`);
  if (!mint.length && !moves.length) { log("already in shape — nothing to do"); return { moved: 0 }; }
  if (dryRun) return { minted: mint.length, moved: moves.length };

  for (const f of mint) {
    await Folder.create({ id: f.id, userId: grid.userId, gridId: gid, parentId: f.parentId,
      name: f.name, sortOrder: f.sortOrder, folderType: "normal", isExpanded: true, meta: {} });
  }
  for (const m of moves) {
    if (m.kind === "folder") await Folder.updateOne({ id: m.id, gridId: gid }, { $set: { parentId: m.to } });
    // A page's home is its `parentId`; its PLACEMENT (a panel tab) is a
    // separate list and is deliberately untouched, so a pinned tab keeps
    // working across the move.
    else await Occurrence.updateOne({ id: m.id, gridId: gid }, { $set: { parentId: m.to } });
  }
  log(`minted ${mint.length} folder(s) · moved ${moves.length} item(s)`);
  return { minted: mint.length, moved: moves.length };
}
