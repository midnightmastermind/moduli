// 0222 — the Spotify library becomes rows on the Artist, Album and Song boards.
//
// User, 2026-08-24: *"add my spotify csv which is in screenshots to my artist,
// album, and song boards"*, then — after a favourites-only first pass — *"put
// the artists and albums in that i dont have. like if i have a song make sure
// the artist is in the artist board"* and *"theres an album with the song in
// the songs field."*
//
//     1594 artists · 2756 albums · 4078 songs   =  8,428 rows
//
// ── EVERY SONG REACHES BOTH, AND THAT IS ASSERTED RATHER THAN HOPED ───────
//
// The boards hold the library's FULL CAST: the 163 artists and 199 albums the
// user starred, plus the 1431 artists and 2557 albums that only ever appear in
// a song's credits. So no song carries a dangling reference and none is left
// without an artist — which was the whole revision.
//
// The starred/credited split is kept on `meta.spotifyFavorite`. The user chose
// those 163 deliberately, and flattening the two into one undifferentiated pile
// discards something the file actually states.
//
// ── AN ALBUM CARRIES ITS SONGS ────────────────────────────────────────────
//
// The reverse link is written in the same pass, from the songs actually
// created, so it cannot disagree with the forward one. It is a MULTI-select
// `Songs` field (`0221`) — deliberately not the existing single-pick `Song`,
// which means "which one song" elsewhere on the grid.
//
// ── THREE MODULES, NOT 8,428 ──────────────────────────────────────────────
//
// The name rides on `occurrence.label`, which
// `optionsResolver.enrichedRecords` resolves ahead of the module's own
// (`occ.label ?? tpl?.label ?? tpl?.name`) and which `ModuleInstance` prefers
// too. Bindings are identical for every song, and a binding lives on the
// module — so one shared module per kind is what a module is FOR. `0218` has
// just finished collapsing 474 near-identical clone modules onto 99; minting
// 8,428 here would undo that lesson at seventeen times the scale.
//
// ── IDENTITY IS THE SPOTIFY ID, REUSING THE SEARCH-PROVIDER MECHANISM ─────
//
// Each row carries `meta.searchProvider = "spotify"` and
// `meta.searchExternalId = <id>` — the pair `searchProviders.gridKeyOf`
// already reads. That buys three things at once: the migration is idempotent
// and RESUMABLE on it (a run that dies at 3,000 leaves the rest to do), and the
// merged dropdown will not offer a row the grid already holds. Titles are NOT
// identity: "Parallel Universe" is both a song and an album in this one file.
//
// ── WRITTEN IN BATCHES ────────────────────────────────────────────────────
//
// 8,428 individual upserts is the shape that took 8.9s for FORTY-NINE rows
// before the 2026-08-20 (4) batching work. `insertMany` in chunks, and the
// parents' `occurrences[]` written ONCE each rather than per child.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readSpotifyLibrary, allArtists, allAlbums, derivedKey } from "../utils/spotifyLibrary.js";

export const id = "0222-import-spotify-library";
export const description = "Import the Spotify library as Artist, Album and Song board rows, linked";

export const CSV_PATH = path.resolve(process.cwd(), "screenshots/My Spotify Library.csv");
const PROVIDER = "spotify";
const CHUNK = 500;

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** `${provider}:${externalId}` — the same key the search merge uses. */
export const rowKey = (occ) =>
  occ?.meta?.searchProvider && occ?.meta?.searchExternalId
    ? `${occ.meta.searchProvider}:${occ.meta.searchExternalId}` : null;

/** How a shared row module is IDENTIFIED — the one predicate, used by the
 *  minter below and by every later migration that has to find what it minted.
 *  It names no `role`: `0223` added one on its own and the perf pass moved
 *  these modules from `instance` to `artifact`, so the finder stopped finding
 *  what the minter makes while both halves still read correctly. */
export const sharedModuleQuery = (gid, label) =>
  ({ gridId: String(gid), label, "meta.spotifyRow": true });

export async function up({ models, gridId, dryRun, log }) {
  const { Module, Occurrence, Field } = models;
  const gid = String(gridId);

  if (!existsSync(CSV_PATH)) { log(`no CSV at ${CSV_PATH} — nothing to import`); return { imported: 0 }; }

  const tagField = await Field.findOne({ gridId: gid, name: "Board Category" }).lean();
  const artistField = await Field.findOne({ gridId: gid, name: "Artist", type: "occurrence" }).lean();
  const albumField = await Field.findOne({ gridId: gid, name: "Album", type: "occurrence" }).lean();
  const songsField = await Field.findOne({ gridId: gid, name: "Songs", type: "occurrence" }).lean();
  const urlField = await Field.findOne({ gridId: gid, name: "URL", type: "text" }).lean();
  if (!tagField || !artistField || !albumField || !songsField) {
    throw new Error("0221 has not run on this grid — Board Category / Artist / Album / Songs missing");
  }

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const tagOf = (o) => { const v = o.fields?.[tagField.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const boardFor = (tag) => occs.find((o) => tagOf(o).includes(tag) && o.feed?.enabled);
  const boards = { artist: boardFor("artist"), album: boardFor("album"), song: boardFor("song") };
  for (const [t, b] of Object.entries(boards)) if (!b) throw new Error(`no ${t} board on this grid — run 0221 first`);

  const lib = readSpotifyLibrary(readFileSync(CSV_PATH, "utf8"));
  const artists = allArtists(lib), albums = allAlbums(lib);
  log(`CSV: ${lib.songs.length} songs · ${lib.skipped.length} skipped`);
  log(`full cast: ${artists.length} artists (${artists.filter((a) => a.favorite).length} starred) · ` +
      `${albums.length} albums (${albums.filter((a) => a.favorite).length} starred)`);

  // Identity: a starred row has a Spotify id; a credited-only row has none (the
  // id on a song row belongs to the SONG), so it gets a deterministic key of its
  // own or a re-run would mint it again.
  const extId = { artist: (a) => a.spotifyId || derivedKey("artist", a.key),
                  album:  (a) => a.spotifyId || derivedKey("album", a.key) };

  const have = new Map();
  const byOccId = new Set(occs.map((o) => o.id));
  for (const o of occs) { const k = rowKey(o); if (k) have.set(k, o); }
  const plan = {
    artists: artists.filter((a) => !have.has(`${PROVIDER}:${extId.artist(a)}`)),
    albums:  albums.filter((a) => !have.has(`${PROVIDER}:${extId.album(a)}`)),
    songs:   lib.songs.filter((s) => !have.has(`${PROVIDER}:${s.spotifyId}`)),
  };
  log(`already on the grid: ${have.size}`);
  log(`to import: ${plan.artists.length} artists · ${plan.albums.length} albums · ${plan.songs.length} songs`);
  if (dryRun) return { artists: plan.artists.length, albums: plan.albums.length, songs: plan.songs.length };

  const userId = boards.song.userId;

  async function sharedModule(label, kind, bindings) {
    const found = await Module.findOne(sharedModuleQuery(gid, label)).lean();
    if (found) {
      // A re-run after `0221` gained a field must WIDEN the module, or the new
      // control has no binding and the value it holds renders nowhere.
      const haveIds = new Set((found.fieldBindings || []).map((b) => b.fieldId));
      const add = bindings.filter((b) => !haveIds.has(b.fieldId));
      if (add.length) {
        await Module.updateOne({ id: found.id, gridId: gid },
          { $set: { fieldBindings: [...(found.fieldBindings || []), ...add] } });
        log(`  widened "${label}" with ${add.length} binding(s)`);
      }
      return found.id;
    }
    const mid = uid();
    await Module.create({ id: mid, userId, gridId: gid, label, role: "artifact", kind,
      fieldBindings: bindings, meta: { spotifyRow: true } });
    log(`  minted shared module "${label}" (${mid})`);
    return mid;
  }
  const bind = (fid) => ({ fieldId: fid });
  // ARTIFACT role — the measured decision, see 0221's feed comment. `kind`
  // distinguishes them the way `bookmark` distinguishes a saved link.
  const u = urlField ? [bind(urlField.id)] : [];
  const artistModId = await sharedModule("Artist", "artist", [bind(tagField.id), ...u]);
  const albumModId  = await sharedModule("Album",  "album",  [bind(tagField.id), bind(artistField.id), bind(songsField.id), ...u]);
  const songModId   = await sharedModule("Song",   "song",   [bind(tagField.id), bind(artistField.id), bind(albumField.id), ...u]);

  // Rows already present, keyed the way the CSV keys them, so a RESUMED run
  // links to what an earlier pass created rather than re-minting it.
  const idFor = { artist: new Map(), album: new Map() };
  for (const [k, o] of have) {
    if (k.startsWith(`${PROVIDER}:artist:`)) idFor.artist.set(k.slice(`${PROVIDER}:artist:`.length), o.id);
    else if (k.startsWith(`${PROVIDER}:album:`)) idFor.album.set(k.slice(`${PROVIDER}:album:`.length), o.id);
  }
  // Starred rows carry a real Spotify id, so they are matched by NAME instead.
  for (const a of artists) if (a.spotifyId && have.has(`${PROVIDER}:${a.spotifyId}`)) idFor.artist.set(a.key, have.get(`${PROVIDER}:${a.spotifyId}`).id);
  for (const a of albums)  if (a.spotifyId && have.has(`${PROVIDER}:${a.spotifyId}`)) idFor.album.set(a.key, have.get(`${PROVIDER}:${a.spotifyId}`).id);

  const made = { artist: 0, album: 0, song: 0 };
  const newIds = { artist: [], album: [], song: [] };
  async function insertAll(rows, build, kind) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const docs = rows.slice(i, i + CHUNK).map(build);
      if (docs.length) await Occurrence.insertMany(docs, { ordered: false });
      made[kind] += docs.length;
      newIds[kind].push(...docs.map((d) => d.id));
      log(`  ${kind}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
    }
  }
  // ── THE LINK GOES IN THE `URL` FIELD, NOT IN `fileRef` ──────────────────
  //
  // A bookmark is an artifact whose MODULE carries `fileRef` — one module per
  // bookmark, so that works there. These 8,428 rows SHARE three modules, so a
  // per-row link cannot live on the module.
  //
  // And it cannot live on the occurrence either: `fileRef` is declared on
  // `Module` and NOWHERE on `Occurrence`, so Mongoose strict mode would drop it
  // on save without a word — the exact class that hid `Operation.priority` for
  // months and stripped `Folder.manifestId` from every folder `0199` minted.
  // Checked the schema rather than assuming, because the write would have
  // "succeeded" every time.
  //
  // `URL` is a real text field (minted by `0061` for the bookmark intake, and
  // currently unused), so the link is visible, clickable and editable.
  const SPOTIFY_PATH = { artist: "artist", album: "album", song: "track" };
  const base = (moduleId, tag, label, eid, fields, meta) => ({
    id: uid(), userId, gridId: gid, moduleId, parentId: boards[tag].id, occurrences: [], label,
    fields: { [tagField.id]: { value: [tag], flow: "in" }, ...fields },
    meta: { searchProvider: PROVIDER, searchExternalId: eid, ...meta },
    filterOverride: {},
  });
  /** The Spotify page for a row, when the export gave us a real id.
   *  A DERIVED row (a credited artist, a fetched track) has none — its `eid` is
   *  our own `artist:<name>` key, and turning that into a URL would produce a
   *  link that 404s. No fileRef is the honest answer there. */
  const spotifyRef = (tag, eid) =>
    eid && !eid.includes(":") ? `https://open.spotify.com/${SPOTIFY_PATH[tag]}/${eid}` : null;
  const withUrl = (doc, tag, eid) => {
    const ref = spotifyRef(tag, eid);
    if (ref && urlField) doc.fields[urlField.id] = { value: ref, flow: "in" };
    return doc;
  };

  // ORDER: artists, then albums (they link an artist), then songs (both).
  await insertAll(plan.artists, (a) => {
    const eid = extId.artist(a);
    const doc = base(artistModId, "artist", a.name, eid, {}, { spotifyFavorite: a.favorite });
    withUrl(doc, "artist", eid);
    idFor.artist.set(a.key, doc.id);
    return doc;
  }, "artist");

  await insertAll(plan.albums, (al) => {
    const aid = idFor.artist.get(al.artistKey) || null;
    const eid = extId.album(al);
    const doc = base(albumModId, "album", al.title, eid,
      aid ? { [artistField.id]: { value: aid, flow: "in" } } : {},
      { spotifyArtist: al.artist, spotifyFavorite: al.favorite });
    withUrl(doc, "album", eid);
    idFor.album.set(al.key, doc.id);
    return doc;
  }, "album");

  const songIdByAlbumKey = new Map();
  await insertAll(plan.songs, (s) => {
    const f = {};
    const aid = idFor.artist.get(s.artistKey) || null;
    const bid = s.album ? idFor.album.get(s.albumKey) || null : null;
    if (aid) f[artistField.id] = { value: aid, flow: "in" };
    if (bid) f[albumField.id] = { value: bid, flow: "in" };
    const doc = base(songModId, "song", s.title, s.spotifyId, f,
      { spotifyArtist: s.artist, spotifyAlbum: s.album, isrc: s.isrc || undefined });
    withUrl(doc, "song", s.spotifyId);
    if (bid) songIdByAlbumKey.set(s.albumKey, (songIdByAlbumKey.get(s.albumKey) || []).concat(doc.id));
    return doc;
  }, "song");

  // ── RE-LINK the songs that were already here ────────────────────────────
  //
  // A song imported by an earlier, narrower pass points at nothing if its
  // artist did not exist yet. Now that the full cast does, those links are
  // resolvable — so this pass makes the migration CONVERGENT rather than merely
  // additive: run it twice and the second run finishes the first one's work
  // instead of leaving half the library unconnected.
  //
  // It only ever FILLS a link that is absent or dangling. A link the user
  // re-pointed by hand is left exactly as it is.
  const relinkOps = [];
  for (const s2 of lib.songs) {
    const existing = have.get(`${PROVIDER}:${s2.spotifyId}`);
    if (!existing) continue;                       // just created above
    const set = {};
    const aid = idFor.artist.get(s2.artistKey) || null;
    const bid = s2.album ? idFor.album.get(s2.albumKey) || null : null;
    const cur = (fid) => existing.fields?.[fid]?.value || null;
    if (aid && (!cur(artistField.id) || !byOccId.has(cur(artistField.id)))) set[`fields.${artistField.id}`] = { value: aid, flow: "in" };
    if (bid && (!cur(albumField.id) || !byOccId.has(cur(albumField.id)))) set[`fields.${albumField.id}`] = { value: bid, flow: "in" };
    if (Object.keys(set).length) relinkOps.push({ updateOne: { filter: { id: existing.id, gridId: gid }, update: { $set: set } } });
    if (bid) songIdByAlbumKey.set(s2.albumKey, (songIdByAlbumKey.get(s2.albumKey) || []).concat(existing.id));
  }
  for (let i = 0; i < relinkOps.length; i += CHUNK) {
    await Occurrence.bulkWrite(relinkOps.slice(i, i + CHUNK), { ordered: false });
  }
  if (relinkOps.length) log(`re-linked ${relinkOps.length} song(s) that predate the full cast`);

  // ── the album -> songs reverse link ─────────────────────────────────────
  // Built from the songs THIS RUN resolved, so it cannot disagree with the
  // forward link. One write per album, never one per song.
  let wroteSongs = 0;
  const albumOps = [];
  for (const [aKey, ids] of songIdByAlbumKey) {
    const albumId = idFor.album.get(aKey);
    if (!albumId || !ids.length) continue;
    albumOps.push({ updateOne: { filter: { id: albumId, gridId: gid },
      update: { $set: { [`fields.${songsField.id}`]: { value: ids, flow: "in" } } } } });
  }
  for (let i = 0; i < albumOps.length; i += CHUNK) {
    const slice = albumOps.slice(i, i + CHUNK);
    if (slice.length) await Occurrence.bulkWrite(slice, { ordered: false });
    wroteSongs += slice.length;
  }
  log(`albums carrying their songs: ${wroteSongs}`);

  // ── THE ROWS ARE PARENTED INTO THEIR BOARD, AND THAT IS LOAD-BEARING ────
  //
  // These boards are FEED-BACKED, and `syncFeed` mints a COPY of every match it
  // does not already own. Left as unparented sources, 8,428 rows would become
  // 8,428 MORE on the next load — the grid would go from 7.4k occurrences to
  // ~24k, in one client-side burst, on a grid this repo has already had to
  // rescue from a 1,347-container scan.
  //
  // `resolveFeedItems` settles it (selectors.js): `if
  // (ancestors.includes(feedOcc.id)) continue — already an owned descendant`.
  // A row PARENTED to the board is excluded from its own feed and renders as
  // the container's own child. So parenting is not bookkeeping here; it is what
  // stops the import from doubling itself.
  //
  // The feed stays ENABLED, so anything tagged `song` elsewhere later is still
  // pulled in. Both mechanisms coexist exactly as the exclusion intends.
  // ONE `$push $each` per board rather than one per row — the 2026-08-20 (4)
  // lesson, where 49 per-child pushes cost 8.9s. `$each` also preserves the
  // order the rows were built in.
  for (const [tag, ids] of Object.entries(newIds)) {
    if (!ids.length) continue;
    for (let i = 0; i < ids.length; i += CHUNK) {
      await Occurrence.updateOne({ id: boards[tag].id, gridId: gid },
        { $push: { occurrences: { $each: ids.slice(i, i + CHUNK) } } });
    }
    log(`  listed ${ids.length} row(s) under the ${tag} board`);
  }

  log(`imported ${made.artist} artists · ${made.album} albums · ${made.song} songs`);
  return { artists: made.artist, albums: made.album, songs: made.song };
}
