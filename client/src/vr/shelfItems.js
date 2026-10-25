// vr/shelfItems.js — what a shelf holds: its saved query, answered by the same
// code an occurrence feed uses (`resolveFeedItems`), turned into the things the
// VR office draws. Pure; no copies are made.
//
// Each item: { id, rowId, title, cover, fileId, fileKind, src }
//   rowId   the occurrence the query matched
//   id      what pointing at it opens: the row's readable/playable file when it
//           has one of the shelf's kind, else the row itself
//   cover   a picture url for the sleeve / spine / case, or null
//   src     the readable/playable file's url (a record player plays it, a VHS player runs it on a screen), or null
import { resolveFeedItems } from "../state/selectors";
import { filesOf, primaryMediaOf } from "../helpers/occurrenceMedia";
import { occurrenceDisplayLabel } from "../helpers/occurrenceLabel";
import { resolveFileRef } from "../helpers/fileRef";

// Which file kinds an asset can use (the reader for books, the player for
// records and tapes — plan §3-§5).
export const FILE_KINDS_FOR_ASSET = {
  book: ["pdf", "ebook"],
  record: ["audio"],
  vhs: ["video"],
};

function coverUrl(occ, mod, media) {
  if (media?.src && (media.kind === "image" || !media.kind)) return media.src;
  for (const c of [occ?.meta?.cover, mod?.meta?.cover]) {
    if (typeof c === "string" && c) return resolveFileRef(c);
    if (c && typeof c === "object" && typeof c.url === "string") return resolveFileRef(c.url);
  }
  return null;
}

/** Every folder under `rootId` (itself included). */
function folderTree(rootId, foldersById) {
  const kids = new Map();
  for (const f of Object.values(foldersById || {})) {
    if (!f?.parentId) continue;
    if (!kids.has(f.parentId)) kids.set(f.parentId, []);
    kids.get(f.parentId).push(f.id);
  }
  const out = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) for (const k of kids.get(stack.pop()) || []) if (!out.has(k)) { out.add(k); stack.push(k); }
  return out;
}

/**
 * A folder shelf: every page homed in the folder or any folder under it, by title — a doc page is its own book,
 * opened by pointing at it. The folder's own folder page (kind "folder") is not a book. Files of the shelf's kind are
 * on it too (a VHS shelf holds the folder's videos, a record crate its audio), so the players have something to play.
 */
export function folderShelfItems(rootId, { grid, occurrencesById, modulesById, foldersById, asset = "book" } = {}) {
  const fileKinds = FILE_KINDS_FOR_ASSET[asset] || [];
  if (!rootId || !occurrencesById) return [];
  const under = folderTree(rootId, foldersById);
  const gridId = grid?._id || grid?.id || null;
  const out = [];
  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.parentId || !under.has(occ.parentId)) continue;
    if (gridId && occ.gridId && occ.gridId !== gridId) continue;
    const mod = modulesById?.[occ.moduleId];
    const isFile = mod?.role === "artifact" && fileKinds.includes(mod.kind);
    if (!isFile && (mod?.role !== "page" || mod.kind === "folder")) continue;
    const title = (occurrenceDisplayLabel(occ, mod) || mod?.meta?.originalName || "").trim();
    if (!title) continue;
    out.push({
      id: occ.id, rowId: occ.id, title, cover: coverUrl(occ, mod, null),
      fileId: isFile ? occ.id : null, fileKind: isFile ? mod.kind : null,
      src: isFile && mod.fileRef ? resolveFileRef(mod.fileRef) : null,
    });
  }
  // Up to 3,000: a Documents shelf holds the whole codex (~2,500 notes).
  return out.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 3000);
}

/**
 * A folder shelf seen as a TREE (the headset): standing in folder `at` (default the shelf's root), its subfolders
 * that hold anything are books of their own (`folder: true`, `count` = what is under them) and come first, then what
 * sits directly in `at`. `path` is root..at by name, `canUp` whether there is a level above inside the shelf. A
 * folder `at` that is not under the root (deleted, moved) falls back to the root. Pure.
 */
export function folderShelfView(rootId, at, { grid, occurrencesById, modulesById, foldersById, asset = "book" } = {}) {
  if (!rootId) return { items: [], path: [], canUp: false, at: null };
  const under = folderTree(rootId, foldersById);
  const here = at && under.has(at) ? at : rootId;
  const all = folderShelfItems(rootId, { grid, occurrencesById, modulesById, foldersById, asset });
  // Which child of `here` (if any) each item sits under.
  const childOf = (folderId) => {
    let f = folderId;
    for (let n = 0; f && n < 64; n++) {
      const parent = foldersById?.[f]?.parentId;
      if (parent === here) return f;
      f = parent;
    }
    return null;
  };
  const counts = new Map();
  const direct = [];
  for (const it of all) {
    const parent = occurrencesById?.[it.rowId]?.parentId;
    if (parent === here) { direct.push(it); continue; }
    const c = childOf(parent);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const folders = [...counts.entries()]
    .map(([fid, count]) => ({ id: "folder:" + fid, rowId: null, folder: true, count, title: foldersById?.[fid]?.name || "Folder", cover: null, fileId: null, fileKind: null, src: null }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const path = [];
  for (let f = here, n = 0; f && n < 64; n++) {
    path.unshift({ id: f, title: foldersById?.[f]?.name || "Folder" });
    if (f === rootId) break;
    f = foldersById?.[f]?.parentId;
  }
  return { items: [...folders, ...direct], path, canUp: here !== rootId, at: here };
}

/** The address a bookmark row opens (its saved page), or null. */
/**
 * Spotify's own player for a row that links to Spotify (an album's URL field holds open.spotify.com/album/…): the
 * record player plays it when the row has no audio file of its own. Null when no field holds a Spotify link. Pure.
 */
export function spotifyEmbedUrl(occ) {
  for (const cell of Object.values(occ?.fields || {})) {
    const v = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
    if (typeof v !== "string") continue;
    const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(album|track|playlist|artist|episode|show)\/([A-Za-z0-9]+)/.exec(v);
    if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  }
  return null;
}

/** Spotify's search for a song, when it has no Spotify link of its own (the record player opens it; you pick the
 *  first hit). Null without a title. Pure. */
export function spotifySearchUrl(artist, title) {
  const q = [artist, title].filter((x) => typeof x === "string" && x.trim()).join(" ").trim();
  return title && q ? `https://open.spotify.com/search/${encodeURIComponent(q)}` : null;
}

/** The name of the artist row a row's fields point at, or null. Pure. */
function artistNamed(occ, { occurrencesById, modulesById } = {}) {
  for (const cell of Object.values(occ?.fields || {})) {
    const v = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
    for (const id of Array.isArray(v) ? v : [v]) {
      const a = typeof id === "string" ? occurrencesById?.[id] : null;
      const m = a && modulesById?.[a.moduleId];
      if (m?.kind === "artist") return (occurrenceDisplayLabel(a, m) || "").trim() || null;
    }
  }
  return null;
}

/** Whether a row's own fields name a song (cheap: no scan of the grid). */
function namesSongs(occ, modulesById, occurrencesById) {
  for (const cell of Object.values(occ?.fields || {})) {
    const v = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
    for (const id of Array.isArray(v) ? v : [v]) if (typeof id === "string" && modulesById?.[occurrencesById?.[id]?.moduleId]?.kind === "song") return true;
  }
  return false;
}

/** The song rows an album row names (its Songs field, in its order), then any song naming the album. Pure. */
export function albumSongIds(albumId, { occurrencesById, modulesById } = {}) {
  const album = occurrencesById?.[albumId];
  if (!album) return [];
  const isSong = (id) => modulesById?.[occurrencesById?.[id]?.moduleId]?.kind === "song";
  const out = [];
  const seen = new Set();
  for (const cell of Object.values(album.fields || {})) {
    const v = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
    for (const id of Array.isArray(v) ? v : [v]) if (typeof id === "string" && !seen.has(id) && isSong(id)) { seen.add(id); out.push(id); }
  }
  // Songs naming the album, in track order when they carry one (songs filled in from a track list do).
  const naming = [];
  for (const o of Object.values(occurrencesById || {})) {
    if (seen.has(o.id) || !isSong(o.id)) continue;
    if (Object.values(o.fields || {}).some((c) => (c && typeof c === "object" ? c.value : c) === albumId)) { seen.add(o.id); naming.push(o); }
  }
  const num = (o) => (Number.isFinite(o.meta?.trackNumber) ? o.meta.trackNumber : Infinity);
  naming.sort((a, b) => num(a) - num(b));
  for (const o of naming) out.push(o.id);
  return out;
}

/**
 * An album opened on a record shelf: each of its songs as a mini record — its own audio file if it has one, else
 * the album's Spotify player (a song row carries no Spotify link of its own). Pure.
 */
export function albumShelfItems(albumId, { occurrencesById, modulesById } = {}) {
  const album = occurrencesById?.[albumId];
  if (!album) return [];
  const albumMod = modulesById?.[album.moduleId];
  const ctx = { occurrencesById, modulesById };
  const albumCover = coverUrl(album, albumMod, primaryMediaOf(album, ctx));
  const albumSpotify = spotifyEmbedUrl(album);
  return albumSongIds(albumId, ctx).map((id) => {
    const occ = occurrencesById[id];
    const mod = modulesById?.[occ.moduleId];
    const f = filesOf(occ, ctx).find((e) => e.kind === "audio");
    const ref = f ? modulesById?.[f.occ.moduleId]?.fileRef : null;
    return {
      id: f?.occ?.id || occ.id, rowId: occ.id,
      title: (occurrenceDisplayLabel(occ, mod) || "").trim() || "Song",
      cover: coverUrl(occ, mod, primaryMediaOf(occ, ctx)) || albumCover,
      fileId: f?.occ?.id || null, fileKind: f ? "audio" : null,
      src: ref ? resolveFileRef(ref) : null,
      // A mini record is ONE song: its own Spotify link, else Spotify's search for that song — never the album's
      // link, which plays the whole album from the start (user, 2026-10-25). The album's is the last resort.
      spotify: spotifyEmbedUrl(occ)
        || spotifySearchUrl(occ.meta?.spotifyArtist || occ.meta?.mediaArtist || artistNamed(occ, ctx) || album.meta?.mediaArtist || artistNamed(album, ctx), (occurrenceDisplayLabel(occ, mod) || "").trim())
        || albumSpotify,
      mini: true,
    };
  });
}

export function bookmarkUrl(occ, mod) {
  if (mod?.kind !== "bookmark") return null;
  const u = occ?.meta?.url || mod.fileRef || "";
  return /^https?:\/\//i.test(u) ? u : null;
}

export function shelfItems(shelf, { grid, occurrencesById, modulesById, foldersById } = {}) {
  if (shelf?.folderId) return folderShelfItems(shelf.folderId, { grid, occurrencesById, modulesById, foldersById, asset: shelf.asset });
  if (!shelf?.feed || !occurrencesById) return [];
  // A shelf nobody has given a query yet holds NOTHING. A feed with no
  // conditions and no scope means "every row on the grid" (a real feed shape),
  // which on a fresh shelf filled it with 200 random rows (seen in a browser).
  const hasQuery = (Array.isArray(shelf.feed.conditions) && shelf.feed.conditions.length > 0) || !!shelf.feed.scope;
  if (!hasQuery) return [];
  const owner = { id: shelf.id, gridId: grid?._id || grid?.id || null, feed: { ...shelf.feed, enabled: true } };
  const rows = resolveFeedItems(owner, { occurrencesById, modulesById });
  const wanted = FILE_KINDS_FOR_ASSET[shelf.asset] || [];
  const ctx = { occurrencesById, modulesById };
  const out = [];
  for (const { occurrence: occ, module } of rows) {
    const mod = module || modulesById?.[occ.moduleId];
    const title = (occurrenceDisplayLabel(occ, mod) || mod?.meta?.originalName || "").trim();
    if (!title) continue;
    let file = null;
    if (mod?.role === "artifact" && wanted.includes(mod.kind)) file = { id: occ.id, kind: mod.kind, ref: mod.fileRef };
    else {
      const f = filesOf(occ, ctx).find((e) => wanted.includes(e.kind));
      if (f) file = { id: f.occ.id, kind: f.kind, ref: modulesById?.[f.occ.moduleId]?.fileRef };
    }
    out.push({
      id: file?.id || occ.id,
      rowId: occ.id,
      title,
      cover: coverUrl(occ, mod, primaryMediaOf(occ, ctx)),
      fileId: file?.id || null,
      fileKind: file?.kind || null,
      src: file?.ref ? resolveFileRef(file.ref) : null,
      url: bookmarkUrl(occ, mod),
      spotify: spotifyEmbedUrl(occ),
      // An album on a record shelf opens into its songs when dropped anywhere but a record player.
      album: shelf.asset === "record" && namesSongs(occ, modulesById, occurrencesById),
    });
  }
  return out;
}
