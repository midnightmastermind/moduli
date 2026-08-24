// 0223 — a liked album brings its WHOLE tracklist.
//
// User, 2026-08-24: *"if i liked the album, do all the songs from the album."*
//
// A Spotify library export lists the tracks you liked INDIVIDUALLY. So a
// starred album arrives with only the handful that happened to be liked on
// their own — measured after `0222`, **81 of the 199 starred albums arrived
// with no songs at all**, and the rest with a partial list. MusicBrainz is the
// catalogue that can say what the record actually contains.
//
// ── ONLY STARRED ALBUMS, WHICH IS THE WHOLE SCOPE ─────────────────────────
//
// `meta.spotifyFavorite` is the discriminator `0222` preserved for exactly
// this. The other 2,557 albums exist only because a song credited them; the
// user never said they wanted those records in full, and fetching them would
// be ~2,500 more lookups and tens of thousands of songs nobody asked for.
//
// ── IT IS RESUMABLE, AND THAT IS NOT OPTIONAL AT THIS SIZE ────────────────
//
// ~199 albums x 2 requests at MusicBrainz's 1-req/sec limit is several minutes
// of network. An album is skipped once it carries `meta.tracklistFetchedAt`, so
// a run that dies at album 120 resumes at 121 rather than starting over — and
// re-running after adding albums only fetches the new ones. The stamp is
// written EVEN WHEN THE LOOKUP FOUND NOTHING, or every future run would retry
// the same unknown records forever.
//
// ── IT REFUSES RATHER THAN HALF-FILLING ───────────────────────────────────
//
// If the first 20 albums all fail to reach MusicBrainz, the run aborts: that is
// not twenty obscure records, it is the service being down, and a half-filled
// board is worse than an untouched one because nothing says which half. A
// single album that genuinely is not in the catalogue never stops the run —
// this is a real library and some releases are not there.
//
// ── A FETCHED TRACK IS NOT A SPOTIFY ROW ──────────────────────────────────
//
// It has no Spotify id, so it gets a deterministic identity of its own
// (`album:<albumKey>:track:<title>`) — the same rule `0222` uses for a credited
// artist. Matching against what is already on the album is by NORMALISED TITLE,
// because the liked-song row and the catalogue row are the same track under two
// spellings ("Nikes on My Feet" vs "Nikes On My Feet").

import { albumTracks, baseTitle } from "../utils/providers/musicbrainz.js";
import { normName } from "../utils/spotifyLibrary.js";
import { sharedModuleQuery } from "./0222-import-spotify-library.mjs";

export const id = "0223-liked-album-full-tracklist";
export const description = "Fill each starred album with its complete tracklist from MusicBrainz";

const PROVIDER = "spotify";
const ABORT_AFTER_CONSECUTIVE_FAILURES = 20;
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** Which catalogue tracks are missing from what the album already holds. PURE. */
export function missingTracks(catalogTracks, haveTitles) {
  const have = new Set((haveTitles || []).map(normName));
  const seen = new Set();
  const out = [];
  for (const t of catalogTracks || []) {
    const k = normName(t.title);
    if (!k || have.has(k) || seen.has(k)) continue;   // already there, or the
    seen.add(k);                                      // catalogue listed it twice
    out.push(t);
  }
  return out;
}

export async function up({ models, gridId, dryRun, log }) {
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

  // The MINTER's own predicate, imported rather than restated. Written out
  // here it read `role: "instance"`, which stopped matching the moment the perf
  // pass made these modules `artifact` — and the failure was this migration
  // announcing that `0222` had never run, on a grid where it demonstrably had.
  const songModule = await Module.findOne(sharedModuleQuery(gid, "Song")).lean();
  if (!songModule) throw new Error("0222 has not run — no shared Song module");

  const starred = occs.filter((o) => tagOf(o).includes("album") && o.meta?.spotifyFavorite);
  // A row fetched by a version that did NOT try the stripped title, which came
  // back empty and whose title carries a strippable qualifier, is the one case
  // worth asking again — `"Parallel Universe (Deluxe Edition)"` returned
  // nothing and `"Parallel Universe"` returns 14 tracks. At most ONE retry:
  // the stamp below marks the row as having had the better lookup, so a record
  // that is genuinely absent is still never asked about twice.
  const retryable = (a) =>
    a.meta?.tracklistCount === 0 && !a.meta?.tracklistBaseFallback && !!baseTitle(a.label);
  const todo = starred.filter((a) => !a.meta?.tracklistFetchedAt || retryable(a));
  const retries = todo.filter((a) => a.meta?.tracklistFetchedAt).length;
  if (retries) log(`  (${retries} of those are empty results being re-asked with the qualifier stripped)`);
  log(`starred albums: ${starred.length} · already fetched: ${starred.length - todo.length} · to fetch: ${todo.length}`);
  if (dryRun) return { albums: todo.length };
  if (!todo.length) { log("nothing to fetch"); return { albums: 0, songs: 0 };  }

  let consecutiveFailures = 0, fetched = 0, created = 0, empty = 0;
  for (const album of todo) {
    const artistName = album.meta?.spotifyArtist || byId.get(album.fields?.[artistField.id]?.value)?.label || "";
    const existingIds = album.fields?.[songsField.id]?.value || [];
    const haveTitles = existingIds.map((sid) => byId.get(sid)?.label).filter(Boolean);

    let tracks = [];
    try {
      const r = await albumTracks(album.label, artistName, { trackHint: existingIds.length });
      tracks = r.tracks;
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures++;
      log(`  ! "${album.label}" — ${e.message}`);
      if (consecutiveFailures >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
        // Not twenty obscure records — the service is unreachable.
        throw new Error(`${consecutiveFailures} consecutive lookups failed; aborting rather than half-filling the board`);
      }
      continue;                       // no stamp: a network failure is retryable
    }
    fetched++;
    if (!tracks.length) empty++;

    const missing = missingTracks(tracks, haveTitles);
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
        searchProvider: PROVIDER,
        searchExternalId: `album:${normName(artistName)} ${normName(album.label)}:track:${normName(t.title)}`,
        spotifyArtist: artistName, spotifyAlbum: album.label,
        fromTracklist: true, trackPosition: t.position ?? undefined,
      },
      filterOverride: {},
    }));

    if (docs.length) {
      await Occurrence.insertMany(docs, { ordered: false });
      await Occurrence.updateOne({ id: songBoard.id, gridId: gid },
        { $push: { occurrences: { $each: docs.map((d) => d.id) } } });
      created += docs.length;
    }
    // The album's own Songs list gains the new ids, and the STAMP goes on in
    // the same write — including when nothing was found, so an unknown record
    // is not looked up again on every future run.
    await Occurrence.updateOne({ id: album.id, gridId: gid }, { $set: {
      [`fields.${songsField.id}`]: { value: [...existingIds, ...docs.map((d) => d.id)], flow: "in" },
      "meta.tracklistFetchedAt": new Date().toISOString(),
      "meta.tracklistCount": tracks.length,
      // "this row was looked up by a version that also tries the stripped
      // title" — what stops the retry above firing a second time.
      "meta.tracklistBaseFallback": true,
    } });

    if (fetched % 25 === 0) log(`  ${fetched}/${todo.length} albums · ${created} songs added`);
  }

  log(`fetched ${fetched} albums · ${empty} not in the catalogue · ${created} songs added`);
  return { albums: fetched, songs: created, notFound: empty };
}
