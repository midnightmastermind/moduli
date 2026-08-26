/**
 * 0254 — cover art for the music and book libraries.
 *
 * User, 2026-08-26: *"can you look into giving the rest of the media images"*.
 *
 * ── WHAT WAS ACTUALLY MISSING, MEASURED ─────────────────────────────────
 *
 * ```
 * Songs 5,484 · Albums 3,027 · Artists 1,679 · Books 877 · Authors 296
 * ```
 * The Spotify and Calibre imports carry no artwork — the gap 2026-08-25 named
 * when it refused to tile those boards.
 *
 * ── EVERY SOURCE HERE IS AN EXACT IDENTIFIER, NOT A SEARCH ──────────────
 *
 * `0245` had to SEARCH TMDB by title because a film row carries only its name.
 * These rows carry ids:
 *
 *  - albums and artists store their **Spotify URL**, and Spotify's oEmbed
 *    endpoint returns a `thumbnail_url` for it with **no API key**. Exact row,
 *    exact art — nothing to mis-match.
 *  - books store an **ISBN**.
 *
 * ── SONGS COST NOTHING, AND THAT IS THE BIGGEST WIN ─────────────────────
 *
 * A song row references its Album (`Album = <occurrence id>`), and a song's
 * artwork IS its album's. So the 5,484 songs are DERIVED from the albums after
 * they land — zero network calls for more than half the rows. Fetching them
 * individually would have been 5,484 requests for art we already have.
 *
 * ── OPEN LIBRARY WILL HAND YOU SOMEONE ELSE'S BOOK ──────────────────────
 *
 * This is the trap, found by probing before writing anything. A deliberately
 * bogus ISBN of all zeros does NOT 404:
 *
 * ```
 * covers.openlibrary.org/b/isbn/0000000000000-L.jpg?default=false
 *     -> HTTP 200, 19,683 bytes, a real jpeg
 * openlibrary.org/api/books?bibkeys=ISBN:0000000000000
 *     -> a real book record, with a cover
 * ```
 *
 * So "the ISBN resolved" is not evidence the cover belongs to this book, and a
 * placeholder ISBN would silently attach a stranger's cover — indistinguishable
 * from a correct one at tile size. Every book therefore has to clear a TITLE
 * MATCH against the row's own label before its cover is accepted. That is the
 * same rule `0052` applied to phone numbers and `0054` to addresses: a
 * plausible value the user did not enter is worse than a blank.
 *
 * ── WHAT IS DELIBERATELY LEFT WITHOUT ART ───────────────────────────────
 *
 * Authors (296), Games (4), Comics (5) and the 8 films TMDB never matched carry
 * NO reliable identifier — an image search on "Invincible, main run #000–#144
 * (2003–2018)" is a guess, and `0201` already recorded what guessed covers look
 * like. Reported, not filled.
 *
 * Resumable and idempotent: a row that already has a cover is never fetched.
 */

export const id = "0254-media-covers";
export const describe =
  "Cover art for albums/artists (Spotify oEmbed on their stored URL), books (Open Library by ISBN, gated on a title match) and songs (derived from their album — no network). Leaves rows with no reliable identifier blank.";
export const touches = ["occurrences"];

export const CONCURRENCY = 6;
export const GAP_MS = 60;
export const FETCH_FAIL_ABORT = 20;

/** oEmbed gives one thumbnail; take it or nothing. */
export function spotifyThumb(json) {
  const u = json?.thumbnail_url;
  return typeof u === "string" && /^https:\/\//.test(u) ? u : null;
}

/** Normalise for comparison: case, accents, punctuation and articles all go. */
export function normTitle(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Apostrophes are DELETED, not turned into a separator: the general
    // punctuation rule below would make "Sgt. Pepper's" into "pepper s", which
    // then fails to match the same record spelled "Sgt Peppers". Caught by a
    // test whose expectation I had written the other way round.
    .replace(/['\u2018\u2019]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .trim().replace(/\s+/g, " ");
}

/**
 * Is the book Open Library returned the book on this row? Requires one title to
 * contain the other after normalising — a subtitle or an edition suffix is
 * tolerated, a different book is not.
 */
export function titleMatches(rowLabel, apiTitle) {
  const a = normTitle(rowLabel), b = normTitle(apiTitle);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** The Spotify id kind, so an album URL is never asked of the artist endpoint. */
export function spotifyKind(url) {
  const m = /open\.spotify\.com\/(album|artist|track)\//.exec(String(url || ""));
  return m ? m[1] : null;
}

export async function fetchSpotifyCover(url, fetchImpl = fetch) {
  const res = await fetchImpl(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  if (!res.ok) return null;
  return spotifyThumb(await res.json());
}

/** Returns `{ url, title }` or null. The caller decides whether the title is close enough. */
export async function fetchOpenLibrary(isbn, fetchImpl = fetch) {
  const key = `ISBN:${String(isbn).replace(/[^0-9Xx]/g, "")}`;
  const res = await fetchImpl(`https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`);
  if (!res.ok) return null;
  const rec = (await res.json())?.[key];
  const url = rec?.cover?.large || rec?.cover?.medium || null;
  return url ? { url, title: rec?.title || "" } : null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const fieldId = (n) => fields.find((f) => f.name === n)?.id;
  const URL_F = fieldId("URL"), ISBN_F = fieldId("ISBN"), ALBUM_F = fieldId("Album");
  const kindOf = (o) => modById.get(o.moduleId)?.kind;
  const labelOf = (o) => o.label ?? modById.get(o.moduleId)?.label ?? "";
  const val = (o, f) => (f ? o.fields?.[f]?.value : null);

  const targets = [];
  for (const o of occs) {
    if (o.meta?.cover) continue;
    const k = kindOf(o);
    if (k === "album" || k === "artist") {
      const u = val(o, URL_F);
      if (u && spotifyKind(u)) targets.push({ id: o.id, kind: k, source: "spotify", url: u });
    } else if (k === "book") {
      const isbn = val(o, ISBN_F);
      if (isbn) targets.push({ id: o.id, kind: k, source: "openlibrary", isbn, label: labelOf(o) });
    }
  }
  const songs = occs.filter((o) => kindOf(o) === "song" && !o.meta?.cover && val(o, ALBUM_F));
  const byKind = targets.reduce((a, t) => ((a[t.kind] = (a[t.kind] || 0) + 1), a), {});
  log(`fetch targets: ${targets.length}  (${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(" ") || "none"})`);
  log(`songs to DERIVE from their album afterwards (no network): ${songs.length}`);

  const noId = { album: 0, artist: 0, book: 0, author: 0, game: 0, comic: 0 };
  for (const o of occs) {
    const k = kindOf(o);
    if (!(k in noId) || o.meta?.cover) continue;
    const has = (k === "book") ? !!val(o, ISBN_F) : (k === "album" || k === "artist") ? !!val(o, URL_F) : false;
    if (!has) noId[k]++;
  }
  log(`rows with NO usable identifier (left blank, reported): ${Object.entries(noId).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`);

  if (dryRun) { log("DRY RUN — no requests made, nothing written."); return; }
  if (!targets.length && !songs.length) return;

  let hit = 0, miss = 0, mismatch = 0, fails = 0, aborted = false;
  const queue = [...targets];
  async function worker() {
    while (queue.length && !aborted) {
      const t = queue.shift();
      try {
        let url = null;
        if (t.source === "spotify") {
          url = await fetchSpotifyCover(t.url);
        } else {
          const got = await fetchOpenLibrary(t.isbn);
          if (got && !titleMatches(t.label, got.title)) { mismatch++; url = null; }
          else url = got?.url || null;
        }
        fails = 0;
        if (url) { hit++; await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.cover": url } }); }
        else miss++;
      } catch {
        fails++; miss++;
        if (fails >= FETCH_FAIL_ABORT) {
          aborted = true;
          log(`REFUSING: ${FETCH_FAIL_ABORT} consecutive requests failed — stopping. ${hit} cover(s) written are kept; re-run to continue.`);
        }
      }
      if ((hit + miss) % 200 === 0) log(`  … ${hit + miss}/${targets.length}  hit=${hit} miss=${miss} wrongBook=${mismatch}`);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`fetched: ${hit} written · ${miss} without art · ${mismatch} refused as the WRONG BOOK${aborted ? " (ABORTED)" : ""}`);

  // Songs inherit their album's art — read AFTER the fetch so this run's albums count.
  const fresh = await Occurrence.find({ gridId }).lean();
  const coverById = new Map(fresh.map((o) => [o.id, o.meta?.cover]));
  let derived = 0, noAlbumArt = 0;
  for (const s of songs) {
    const c = coverById.get(String(val(s, ALBUM_F)));
    if (!c) { noAlbumArt++; continue; }
    await Occurrence.updateOne({ gridId, id: s.id }, { $set: { "meta.cover": c } });
    derived++;
  }
  log(`derived: ${derived} song(s) took their album's art · ${noAlbumArt} whose album still has none`);
}
