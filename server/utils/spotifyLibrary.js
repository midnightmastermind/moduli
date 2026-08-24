// utils/spotifyLibrary.js — a Spotify library export, read honestly.
//
// User, 2026-08-24: *"add my spotify csv which is in screenshots to my artist,
// album, and song boards."*
//
// ── THE FILE HOLDS THREE DIFFERENT THINGS AND ONLY ONE COLUMN SAYS SO ──────
//
// Every row has the same seven columns, but `Type` changes what they MEAN:
//
//     Type=Favorite  4078  Track / Artist / Album all filled — a song
//     Type=Album      202  Track name repeats the album title
//     Type=Artist     163  the ARTIST'S NAME IS IN `Track name`;
//                          Artist, Album and ISRC are all BLANK
//
// **Reading `Artist name` to get the artists is the trap.** It yields 1576
// names harvested from song credits and silently drops all 163 the user
// actually starred — the ones with no `Artist name` at all. Measured on the
// real file; the blank counts (163 artist, 163 album, 0 track) are what pin it.
//
// ── FAVOURITES ARE NOT THE SAME SET AS CREDITS, AND BOTH BECOME ROWS ──────
//
//     favourite artists  163  +  credited only 1431  =  1594 artist rows
//     favourite albums   199  +  credited only 2557  =  2756 album rows
//                                                        4078 song rows
//
// The user first chose favourites-only, then revised it: *"put the artists and
// albums in that i dont have. like if i have a song make sure the artist is in
// the artist board."* So the boards hold the library's full cast — 8,428 rows —
// and EVERY song reaches both an artist and an album row (asserted, not hoped).
//
// The starred/credited distinction is still carried on each row (`favorite`),
// because the user starred those 163 deliberately and an import that forgets
// which is which throws away something the file actually says.
//
// `linkSongs` below is kept for the FAVOURITES-ONLY question it answers — it is
// what measured the 1264/871 overlap — but the import no longer needs it, since
// with the full cast every song resolves.
//
// ── IDENTITY IS THE SPOTIFY ID, NEVER THE TITLE ───────────────────────────
//
// All 4443 ids are distinct. The title is not usable as identity even inside
// one file: "Parallel Universe" is both a Red Hot Chili Peppers song and a
// Plain White T's album here. `0035` is what a title match costs.

/** Split one CSV line, honouring "quoted, fields" and "" escapes. */
export function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** The UTF-8 BOM. Spotify's export carries one, and left in place it renames
 *  the first column to "﻿Track name" — so every song silently loses its
 *  title while every other column reads fine. */
const BOM = "﻿";

/** Rows as objects, BOM stripped. */
export function parseCsv(text) {
  const lines = String(text ?? "").replace(new RegExp("^" + BOM), "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.replace(BOM, "").trim());
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

/** Compare names the way a human would: case and inner whitespace only. */
export const normName = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The library, split into the three things it actually holds.
 *
 * @returns {{artists, albums, songs, skipped}} each row carrying `spotifyId`.
 *   `songs[].artistKey` / `.albumKey` are LOOKUP KEYS, not links — the caller
 *   resolves them against the favourites it actually created.
 */
export function readSpotifyLibrary(text) {
  const rows = parseCsv(text);
  const skipped = [];
  const artists = [], albums = [], songs = [];
  const seen = { artist: new Set(), album: new Set(), song: new Set() };

  for (const r of rows) {
    const type = r["Type"] || "";
    const track = r["Track name"] || "";
    const artist = r["Artist name"] || "";
    const album = r["Album"] || "";
    const id = r["Spotify - id"] || "";

    if (type === "Artist") {
      // The name lives in `Track name` here — see the header.
      if (!track) { skipped.push({ why: "artist row with no name", row: r }); continue; }
      const k = normName(track);
      if (seen.artist.has(k)) continue;      // the export can repeat a favourite
      seen.artist.add(k);
      artists.push({ name: track, key: k, spotifyId: id });
    } else if (type === "Album") {
      const title = album || track;
      if (!title) { skipped.push({ why: "album row with no title", row: r }); continue; }
      const k = `${normName(artist)} ${normName(title)}`;
      if (seen.album.has(k)) continue;
      seen.album.add(k);
      albums.push({ title, artist, key: k, artistKey: normName(artist), spotifyId: id });
    } else if (type === "Favorite") {
      if (!track) { skipped.push({ why: "song row with no title", row: r }); continue; }
      // Keyed on the ID when there is one: two different songs legitimately
      // share a title, and even one artist's catalogue repeats titles across a
      // single and its album.
      const k = id || `${normName(artist)} ${normName(track)}`;
      if (seen.song.has(k)) continue;
      seen.song.add(k);
      songs.push({
        title: track, artist, album, spotifyId: id, isrc: r["ISRC"] || "",
        artistKey: normName(artist),
        albumKey: `${normName(artist)} ${normName(album)}`,
      });
    } else {
      skipped.push({ why: `unknown Type "${type}"`, row: r });
    }
  }
  return { artists, albums, songs, skipped };
}

/**
 * EVERY artist in the library — the ones the user starred AND the ones merely
 * credited on a song.
 *
 * User, 2026-08-24: *"put the artists and albums in that i dont have. like if i
 * have a song make sure the artist is in the artist board."* So the board is
 * the library's full cast, not just the favourites.
 *
 * A FAVOURITE WINS THE MERGE, and that is the only reason the two are unioned
 * here rather than concatenated: a starred artist carries a real Spotify id,
 * a merely-credited one has none (the id on a song row belongs to the SONG).
 * Keyed on the normalised name so "Mac Miller" starred and "Mac Miller"
 * credited are one row, not two.
 *
 * `favorite` is preserved because the distinction is the user's own: they
 * starred 163 of 1576 deliberately, and an import that forgets which is which
 * throws away information the file carries.
 */
export function allArtists({ artists = [], songs = [] } = {}) {
  const out = new Map();
  for (const a of artists) out.set(a.key, { ...a, favorite: true });
  for (const s of songs) {
    const k = s.artistKey;
    if (!k || out.has(k)) continue;
    out.set(k, { name: s.artist, key: k, spotifyId: "", favorite: false });
  }
  return [...out.values()];
}

/** Every album, the same way. A credited album keeps the artist it appeared under. */
export function allAlbums({ albums = [], songs = [] } = {}) {
  const out = new Map();
  for (const a of albums) out.set(a.key, { ...a, favorite: true });
  for (const s of songs) {
    const k = s.albumKey;
    if (!k || !s.album || out.has(k)) continue;
    out.set(k, { title: s.album, artist: s.artist, key: k, artistKey: s.artistKey, spotifyId: "", favorite: false });
  }
  return [...out.values()];
}

/**
 * A stable identity for a row the export gives no Spotify id for.
 *
 * A starred artist has an id; one merely credited on a song does not — the id
 * on that row is the SONG's. Without a deterministic key of its own, a derived
 * row could not be recognised on a re-run and every pass would mint it again.
 */
export const derivedKey = (kind, key) => `${kind}:${key}`;

/**
 * Attach each song to the favourites that exist. PURE, so the link rule is
 * testable without a database.
 *
 * A song whose artist is not a favourite gets `artistKey: null` — it is NOT
 * given an invented artist row. That is the user's choice ("favourites,
 * linked") and it is why most songs carry no link.
 */
export function linkSongs(songs, artistKeys, albumKeys) {
  const A = artistKeys instanceof Set ? artistKeys : new Set(artistKeys || []);
  const B = albumKeys instanceof Set ? albumKeys : new Set(albumKeys || []);
  let linkedArtist = 0, linkedAlbum = 0;
  const out = (songs || []).map((s) => {
    const a = A.has(s.artistKey) ? s.artistKey : null;
    const b = B.has(s.albumKey) ? s.albumKey : null;
    if (a) linkedArtist++;
    if (b) linkedAlbum++;
    return { ...s, artistKey: a, albumKey: b };
  });
  return { songs: out, linkedArtist, linkedAlbum };
}
