// 0434 — drill down through music: an artist's "Albums" button shows the Albums board filtered to that artist, an
// album's "Songs" button shows the Songs board filtered to that album, and each board's header has a button back out
// (user, 2026-10-26: "drilldown wont be hardcoded, it would be part of an operation that pretty much just changes
// whats shown on the panel and filters" · "the one we pressed the button in" · no Albums list field on the artist —
// the Albums board filters by each album's own Artist field).
//
// Everything is data the app already has words for: button fields, On Button operations (Update a board's
// filterOverride, UPDATE_VIEW of the panel the button was pressed in — $trigger.panelViewId), and a local filter on
// each board. Editable in the operations editor afterwards.
//
// Also: an album with no Artist value would pass the filter for EVERY artist (a row with no value always passes),
// so each album with none gets its Artist from its songs, else from the artist row of the name it was imported with.
import { randomUUID } from "node:crypto";

export const id = "0434-music-drilldown";
export const describe = "Music drill-down: Albums / Songs buttons + operations, back buttons on the Albums and Songs board headers, an Artist filter on the Albums board and an Album filter on the Songs board; fills each album's Artist from its songs or its imported artist name. Deletes nothing.";
export const touches = ["fields", "operations", "folders", "modules", "occurrences"];

const BOARDS = { artistsPage: "y9v2e9b50sf0", albumsPage: "fikhfl7ec8p0", songsPage: "rWtZZdAV3dVH", albums: "9u204s73cxy8", songs: "omK6EzlhYDoQ" };
const F = { artist: "8wotshpcdlog", album: "9i0yaflshggo" };

const val = (c) => (c && typeof c === "object" && "value" in c ? c.value : c);
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
let n = 0;
const sid = () => `md${Date.now().toString(36)}${(n++).toString(36)}`;
const act = (config) => ({ id: sid(), type: "action", config });

/** The four operations, each listening to its button. Pure. */
export function plan({ albumsField, songsField, backArtistsField, backAlbumsField }) {
  const showAlbums = [
    act({ type: "INIT_VAR", name: "$albumsBoard", expr: `$allItemsById.${BOARDS.albums}` }),
    act({ type: "UPDATE", path: `$albumsBoard.filterOverride.${F.artist}`, value: "$trigger.occurrenceId" }),
    act({ type: "UPDATE_VIEW", viewId: "$trigger.panelViewId", activeOccurrenceId: BOARDS.albumsPage }),
  ];
  const showSongs = [
    act({ type: "INIT_VAR", name: "$songsBoard", expr: `$allItemsById.${BOARDS.songs}` }),
    act({ type: "UPDATE", path: `$songsBoard.filterOverride.${F.album}`, value: "$trigger.occurrenceId" }),
    act({ type: "UPDATE_VIEW", viewId: "$trigger.panelViewId", activeOccurrenceId: BOARDS.songsPage }),
  ];
  // Out: the board's filter is let go of (null — "no filter set", every row shows) and the panel shows the level up.
  const backToArtists = [
    act({ type: "INIT_VAR", name: "$albumsBoard", expr: `$allItemsById.${BOARDS.albums}` }),
    act({ type: "UPDATE", path: `$albumsBoard.filterOverride.${F.artist}`, value: null }),
    act({ type: "UPDATE_VIEW", viewId: "$trigger.panelViewId", activeOccurrenceId: BOARDS.artistsPage }),
  ];
  // Back to the albums of the artist it came from: the Albums board still holds that artist.
  const backToAlbums = [
    act({ type: "INIT_VAR", name: "$songsBoard", expr: `$allItemsById.${BOARDS.songs}` }),
    act({ type: "UPDATE", path: `$songsBoard.filterOverride.${F.album}`, value: null }),
    act({ type: "UPDATE_VIEW", viewId: "$trigger.panelViewId", activeOccurrenceId: BOARDS.albumsPage }),
  ];
  return [
    { name: "Music: Show Albums", field: albumsField, steps: showAlbums, describe: "An artist's Albums button: the panel shows the Albums board, filtered to that artist." },
    { name: "Music: Show Songs", field: songsField, steps: showSongs, describe: "An album's Songs button: the panel shows the Songs board, filtered to that album." },
    { name: "Music: Back to Artists", field: backArtistsField, steps: backToArtists, describe: "The Albums board's ◀ Artists button: its artist filter cleared, the panel shows the Artists board." },
    { name: "Music: Back to Albums", field: backAlbumsField, steps: backToAlbums, describe: "The Songs board's ◀ Albums button: its album filter cleared, the panel shows the Albums board (still on that artist)." },
  ];
}

/** Each album with no Artist: from its songs, else the artist row of its imported name. Pure. */
export function albumArtists({ albums, songs, artists }) {
  const artistIds = new Set(artists.map((a) => a.id));
  const byName = new Map(artists.map((a) => [norm(a.label), a.id]));
  const fromSongs = new Map();
  for (const s of songs) {
    const al = val(s.fields?.[F.album]); const ar = val(s.fields?.[F.artist]);
    if (al && artistIds.has(ar) && !fromSongs.has(al)) fromSongs.set(al, ar);
  }
  const out = [];
  for (const a of albums) {
    if (artistIds.has(val(a.fields?.[F.artist]))) continue;
    const ar = fromSongs.get(a.id) || byName.get(norm(a.meta?.mediaArtist));
    if (ar) out.push({ id: a.id, artistId: ar });
  }
  return out;
}

async function category(Folder, { gridId, userId, kind, name, dryRun, log }) {
  const hit = await Folder.findOne({ gridId, folderType: "category", categoryKind: kind, name }).lean();
  if (hit) return hit.id;
  const fid = randomUUID();
  log(`  new ${kind} category "${name}"`);
  if (!dryRun) await Folder.create({ id: fid, userId, gridId, parentId: null, name, icon: "folder", sortOrder: 310, isExpanded: true, folderType: "category", categoryKind: kind, meta: {} });
  return fid;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation, Folder, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const mods = await Module.find({ gridId, kind: { $in: ["album", "artist", "song"] } }).lean();
  const kindOf = new Map(mods.map((m) => [m.id, m.kind]));
  for (const k of Object.values(BOARDS)) {
    if (!(await Occurrence.exists({ gridId, id: k }))) { log(`  REFUSED: ${k} is not on this grid (the music boards are named by id)`); return; }
  }
  const occs = await Occurrence.find({ gridId, moduleId: { $in: mods.map((m) => m.id) } }).select("id moduleId label fields meta").lean();
  const albums = occs.filter((o) => kindOf.get(o.moduleId) === "album");
  const artists = occs.filter((o) => kindOf.get(o.moduleId) === "artist");
  const songs = occs.filter((o) => kindOf.get(o.moduleId) === "song");
  const fills = albumArtists({ albums, songs, artists });
  log(`  albums ${albums.length} · get an Artist ${fills.length} · still none after: ${albums.filter((a) => !val(a.fields?.[F.artist]) && !fills.some((f) => f.id === a.id)).length}`);

  const albumMods = mods.filter((m) => m.kind === "album");
  const artistMods = mods.filter((m) => m.kind === "artist");
  const [albumsBoard, songsBoard] = await Promise.all([Occurrence.findOne({ gridId, id: BOARDS.albums }).lean(), Occurrence.findOne({ gridId, id: BOARDS.songs }).lean()]);
  const existingButtons = await Field.find({ gridId, type: "button", name: { $in: ["Albums", "Songs", "◀ Artists", "◀ Albums"] } }).lean();
  if (existingButtons.length) { log(`  already there: ${existingButtons.map((f) => f.name).join(", ")}`); return; }
  log(`  buttons: Albums on ${artistMods.length} artist module(s) · Songs on ${albumMods.length} album module(s) · ◀ Artists on the Albums board · ◀ Albums on the Songs board`);
  log(`  filters: Albums board by Artist · Songs board by Album · 4 operations`);
  if (dryRun) return;

  const now = new Date();
  // Albums' Artist.
  for (const m of albumMods) {
    if ((m.fieldBindings || []).some((b) => b.fieldId === F.artist)) continue;
    await Module.updateOne({ gridId, id: m.id }, { $push: { fieldBindings: { fieldId: F.artist, role: "input", order: (m.fieldBindings || []).length } } });
  }
  for (const f of fills) await Occurrence.updateOne({ gridId, id: f.id }, { $set: { [`fields.${F.artist}`]: { value: f.artistId, flow: "in" }, updatedAt: now } });

  // Buttons.
  const fieldCat = await category(Folder, { gridId, userId, kind: "field", name: "Buttons", dryRun, log });
  const opCat = await category(Folder, { gridId, userId, kind: "op", name: "Music", dryRun, log });
  const mk = async (name, label) => { const fid = randomUUID(); await Field.create({ id: fid, userId, gridId, name, type: "button", folderId: fieldCat, meta: { buttonLabel: label } }); return fid; };
  const albumsField = await mk("Albums", "Albums");
  const songsField = await mk("Songs", "Songs");
  const backArtistsField = await mk("◀ Artists", "◀ Artists");
  const backAlbumsField = await mk("◀ Albums", "◀ Albums");
  const bind = async (moduleIds, fieldId) => {
    for (const mid of moduleIds) {
      const m = await Module.findOne({ gridId, id: mid }).lean();
      await Module.updateOne({ gridId, id: mid }, { $push: { fieldBindings: { fieldId, role: "input", order: (m.fieldBindings || []).length } } });
    }
  };
  await bind(artistMods.map((m) => m.id), albumsField);
  await bind(albumMods.map((m) => m.id), songsField);
  await bind([albumsBoard.moduleId], backArtistsField);
  await bind([songsBoard.moduleId], backAlbumsField);

  // Each board filters by its field (no nav pill: the button is how you choose).
  const addFilter = async (occ, fieldId) => {
    if ((occ.filters || []).some((f) => f.fieldId === fieldId)) return;
    await Occurrence.updateOne({ gridId, id: occ.id }, { $push: { filters: { id: sid(), fieldId, active: true, showNav: false, comparator: "IS", hides: false } }, $set: { updatedAt: now } });
  };
  await addFilter(albumsBoard, F.artist);
  await addFilter(songsBoard, F.album);

  for (const p of plan({ albumsField, songsField, backArtistsField, backAlbumsField })) {
    await Operation.create({
      id: randomUUID(), userId, gridId, name: p.name, folderId: opCat, description: p.describe,
      pipeline: { sources: [], steps: p.steps },
      triggerObjects: [{ eventType: "onButton", subjectType: "field", targetId: p.field, priority: 5 }],
      triggerTypes: ["onButton"], triggerType: "onButton", enabled: true,
    });
  }
  log(`  applied. RESTART pm2.`);
}
