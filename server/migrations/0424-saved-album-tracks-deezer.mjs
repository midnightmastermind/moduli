// 0424 — saved albums still missing tracks are filled from Deezer.
//
// User, 2026-10-20: *"you should go through and add occurances for the fill in."*
//
// `0223` filled each saved (starred) album's tracklist from MusicBrainz. Measured
// on poms grid today, of 199 saved albums: 110 full, 58 holding more than their
// count (a liked song plus the catalogue's spelling), and 49 still short —
// 18 EMPTY (mostly singles and live sessions MusicBrainz does not list: Father
// Mountain, sink or swim, the Sugarshack Sessions…), 2 partial, 29 with no count
// at all. Deezer — where the covers already come from (`0258`) — lists them.
//
// Only TRACK TITLES and positions are copied (catalogue data). The new rows are
// shaped exactly like `0223`'s: one shared Song module, the Songs board as
// parent, Album + Artist links, `meta.fromTracklist`, and the album's own Songs
// list gains them in the same write.
//
// The match rule is `0258`'s: BOTH the album title and the artist name must
// match, a title-only hit is refused. A refused request THROWS (a throttled
// endpoint must not look like an album nobody has — `0258`'s lesson), and 15
// consecutive throws abort the run rather than half-fill the board.
//
// Idempotent: an album asked of Deezer is stamped `meta.deezerTracklistAt`, even
// when nothing was found, and never asked again; titles already on the album are
// never added twice (`0223.missingTracks`).

import { normName } from "../utils/spotifyLibrary.js";
import { nameMatches } from "./0257-album-art-itunes.mjs";
import { missingTracks } from "./0223-liked-album-full-tracklist.mjs";
import { sharedModuleQuery } from "./0222-import-spotify-library.mjs";

export const id = "0424-saved-album-tracks-deezer";
export const describe = "Add the missing tracks of saved albums from Deezer's catalogue (track titles only, as new Song rows linked to their album and artist). Nothing is deleted.";
export const touches = ["occurrences"];

const GAP_MS = 350;
const ABORT_AFTER_CONSECUTIVE_FAILURES = 15;
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Deezer album id whose title AND artist both match, else null. PURE. */
export function pickDeezerAlbumId(data, album, artist) {
  for (const r of data || []) {
    if (nameMatches(r?.title, album) && nameMatches(r?.artist?.name, artist)) return r.id ?? null;
  }
  return null;
}

/** A saved album is short of its tracks and has not been asked of Deezer yet. PURE. */
export function needsFill(album, liveSongCount) {
  if (album?.meta?.deezerTracklistAt) return false;
  const count = album?.meta?.tracklistCount;
  if (!count) return true;              // never counted (0 or missing)
  return liveSongCount < count;         // empty or partial
}

/**
 * The catalogue tracks to add. An album already holding at least as many songs
 * as the catalogue lists gets NOTHING: its "missing" titles are the same tracks
 * spelled differently (measured on MMLP2: 27 held, 27 listed, 6 "missing").
 * PURE.
 */
export function tracksToAdd(catalogTracks, haveTitles) {
  if ((haveTitles || []).length >= (catalogTracks || []).length) return [];
  return missingTracks(catalogTracks, haveTitles);
}

async function deezerJson(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`deezer ${res.status}`);
  const js = await res.json();
  if (js && js.error && Object.keys(js.error).length) throw new Error("deezer error payload");
  return js;
}

/** THROWS on a refused request. */
export async function findDeezerAlbumId(album, artist, fetchImpl = fetch) {
  const q = `${album} ${artist}`.trim();
  const js = await deezerJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=10`, fetchImpl);
  return pickDeezerAlbumId(js?.data, album, artist);
}

/** `[{ title, position }]` for a Deezer album. THROWS on a refused request. */
export async function deezerTracks(albumId, fetchImpl = fetch) {
  const js = await deezerJson(`https://api.deezer.com/album/${albumId}/tracks?limit=200`, fetchImpl);
  return (js?.data || [])
    .filter((t) => typeof t?.title === "string" && t.title.trim())
    .map((t) => ({ title: t.title, position: t.track_position ?? null }));
}

export async function up({ models, gridId, dryRun, log, fetchImpl = fetch }) {
  const { Module, Occurrence, Field } = models;
  const gid = String(gridId);

  const tagField = await Field.findOne({ gridId: gid, name: "Board Category" }).lean();
  const artistField = await Field.findOne({ gridId: gid, name: "Artist", type: "occurrence" }).lean();
  const albumField = await Field.findOne({ gridId: gid, name: "Album", type: "occurrence" }).lean();
  const songsField = await Field.findOne({ gridId: gid, name: "Songs", type: "occurrence" }).lean();
  if (!tagField || !artistField || !albumField || !songsField) throw new Error("run 0221 and 0222 first");

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const byId = new Map(occs.map((o) => [o.id, o]));
  const tagOf = (o) => { const v = o.fields?.[tagField.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const songBoard = occs.find((o) => tagOf(o).includes("song") && o.feed?.enabled);
  if (!songBoard) throw new Error("no song board on this grid");
  const songModule = await Module.findOne(sharedModuleQuery(gid, "Song")).lean();
  if (!songModule) throw new Error("0222 has not run — no shared Song module");

  const liveSongIds = (album) => (album.fields?.[songsField.id]?.value || []).filter((sid) => byId.get(sid)?.moduleId === songModule.id);
  const starred = occs.filter((o) => tagOf(o).includes("album") && o.meta?.spotifyFavorite);
  const todo = starred.filter((a) => needsFill(a, liveSongIds(a).length));
  log(`saved albums: ${starred.length} · short of tracks and not yet asked of Deezer: ${todo.length}`);

  let failures = 0, asked = 0, found = 0, created = 0;
  const report = [];
  for (const album of todo) {
    const artistName = album.meta?.spotifyArtist || byId.get(album.fields?.[artistField.id]?.value)?.label || "";
    const existingIds = album.fields?.[songsField.id]?.value || [];
    const haveTitles = liveSongIds(album).map((sid) => byId.get(sid)?.label).filter(Boolean);

    let tracks = [];
    try {
      const dzId = await findDeezerAlbumId(album.label, artistName, fetchImpl);
      await sleep(GAP_MS);
      if (dzId != null) { tracks = await deezerTracks(dzId, fetchImpl); await sleep(GAP_MS); }
      failures = 0;
    } catch (e) {
      failures++;
      log(`  ! "${album.label}" — ${e.message}`);
      if (failures >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
        throw new Error(`${failures} consecutive Deezer lookups failed; aborting rather than half-filling the board`);
      }
      continue;                         // not stamped: a refused request is retryable
    }
    asked++;
    if (tracks.length) found++;
    const missing = tracksToAdd(tracks, haveTitles);
    report.push(`  ${album.label} — ${artistName}: have ${haveTitles.length}, Deezer ${tracks.length}, adding ${missing.length}`);
    if (dryRun) continue;

    const docs = missing.map((t) => ({
      id: uid(), userId: album.userId, gridId: gid, moduleId: songModule.id,
      parentId: songBoard.id, occurrences: [], label: t.title,
      fields: {
        [tagField.id]: { value: ["song"], flow: "in" },
        [albumField.id]: { value: album.id, flow: "in" },
        ...(album.fields?.[artistField.id]?.value
          ? { [artistField.id]: { value: album.fields[artistField.id].value, flow: "in" } } : null),
      },
      meta: {
        searchProvider: "spotify",
        searchExternalId: `album:${normName(artistName)} ${normName(album.label)}:track:${normName(t.title)}`,
        spotifyArtist: artistName, spotifyAlbum: album.label,
        fromTracklist: true, tracklistSource: "deezer",
        ...(t.position != null ? { trackPosition: t.position } : null),
        ...(album.meta?.cover ? { cover: album.meta.cover } : null),
      },
      filterOverride: {},
    }));
    if (docs.length) {
      await Occurrence.insertMany(docs, { ordered: false });
      await Occurrence.updateOne({ id: songBoard.id, gridId: gid },
        { $push: { occurrences: { $each: docs.map((d) => d.id) } } });
      created += docs.length;
    }
    await Occurrence.updateOne({ id: album.id, gridId: gid }, { $set: {
      [`fields.${songsField.id}`]: { value: [...existingIds, ...docs.map((d) => d.id)], flow: "in" },
      "meta.deezerTracklistAt": new Date().toISOString(),
      "meta.deezerTracklistCount": tracks.length,
    } });
  }
  for (const line of report) log(line);
  log(`asked ${asked} · found on Deezer ${found} · ${dryRun ? "would add" : "added"} ${report.reduce((n, l) => n + Number(/adding (\d+)/.exec(l)?.[1] || 0), 0)} songs`);
  return { albums: asked, found, songs: created };
}
