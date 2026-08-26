/**
 * 0259 — the remaining artwork, from this app's own image search.
 *
 * User, 2026-08-26: *"can you do google searches for the remaining artwork"* /
 * *"we have our image search tool"*.
 *
 * ── THIS IS A DIFFERENT CONFIDENCE CLASS, AND IT SHOULD BE SAID ─────────
 *
 * `0245` (TMDB), `0254` (Spotify URL / ISBN) and `0258` (Deezer, title+artist)
 * all matched on an IDENTIFIER or a checked name pair. **A picture search
 * matches on nothing.** The first result for a row's title is a plausible
 * picture, not a verified one — the class `0201` refused for bookmark covers
 * and `0123` refused for prices.
 *
 * It is used here because the user asked for it after seeing what was left
 * blank, which makes it their call rather than a silent guess. Every row it
 * fills is recorded as coming from a search, and it only ever touches rows that
 * have NO cover — nothing verified is overwritten.
 *
 * ── THE QUERY CARRIES THE KIND, because the bare title is ambiguous ─────
 *
 * "Styx" alone is a river; "Styx band musician" is the band. Measured on live
 * rows before writing: artists returned real band photographs, books returned
 * cover scans, games returned box art, and even the comic RANGES ("Invincible,
 * main run #000–#144") returned Invincible covers.
 *
 * ── THE THUMBNAIL, NOT THE SOURCE IMAGE ────────────────────────────────
 *
 * Each result carries `image` (the original host) and `thumbnail` (a Bing CDN
 * URL). The thumbnail is taken: the original frequently hotlink-blocks or 404s,
 * while the CDN copy is stable and already the right size for a tile. It is
 * also what this grid ALREADY uses — the five seeded song posters were
 * `tse4.mm.bing.net/th/id/OIP…`, so this matches the artwork that was here
 * before any import.
 *
 * ── A REFUSAL IS NOT A MISS (the `0257` lesson, applied up front) ───────
 *
 * `searchImages` THROWS on a non-ok response so that a throttled proxy trips
 * the abort guard instead of being counted as "nothing found" — which is how
 * `0257` walked 2,670 albums against an HTTP 403 and wrote 37.
 */

export const id = "0259-image-search-covers";
export const describe =
  "Fills the artwork nothing else could: artists, ISBN-less books, unmatched albums, games and comics, via this app's own /api/images/search. A search result is a plausible picture rather than a verified one — it only ever fills rows that have none.";
export const touches = ["occurrences"];

export const CONCURRENCY = 2;
export const GAP_MS = 500;
export const FETCH_FAIL_ABORT = 12;

/** What to append so a bare title is not ambiguous. */
export const KIND_QUERY = Object.freeze({
  artist: "band musician",
  album: "album cover",
  book: "book cover",
  game: "game cover art",
  comic: "comic book cover",
  movie: "movie poster",
  series: "tv series poster",
});

export function buildQuery(label, kind, extra) {
  const bits = [String(label || "").trim()];
  if (extra) bits.push(String(extra).trim());
  if (KIND_QUERY[kind]) bits.push(KIND_QUERY[kind]);
  return bits.filter(Boolean).join(" ");
}

/** The CDN thumbnail beats the original host — see the header. */
export function pickImage(results) {
  for (const r of results || []) {
    const u = (typeof r === "string") ? r : (r?.thumbnail || r?.image);
    if (typeof u === "string" && /^https:\/\//.test(u)) return u;
  }
  return null;
}

/** THROWS on a refused request so throttling can never read as "no result". */
export async function searchImages(query, base, fetchImpl = fetch) {
  const res = await fetchImpl(`${base}/api/images/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`images/search ${res.status}`);
  const js = await res.json();
  return pickImage(js?.results);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const base = process.env.IMG_BASE || "https://viafluere.com";
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const occById = new Map(occs.map((o) => [o.id, o]));
  const kindOf = (o) => modById.get(o.moduleId)?.kind;
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "";
  const fid = (n) => fields.find((f) => f.name === n && f.type === "occurrence")?.id;
  const ARTIST = fid("Artist"), ALBUM = fid("Album");

  const targets = [];
  for (const o of occs) {
    const k = kindOf(o);
    if (!KIND_QUERY[k] || o.meta?.cover) continue;
    if (k === "song") continue;                       // songs inherit; never searched
    // An album search is much better with its artist, and the row knows it.
    const extra = k === "album" ? labelOf(occById.get(String(o.fields?.[ARTIST]?.value || ""))) : null;
    const label = labelOf(o);
    if (!label.trim()) continue;                      // nothing to search for
    targets.push({ id: o.id, kind: k, q: buildQuery(label, k, extra) });
  }
  const byKind = targets.reduce((a, t) => ((a[t.kind] = (a[t.kind] || 0) + 1), a), {});
  log(`rows to search: ${targets.length}  (${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(" ") || "none"})`);
  log(`  e.g. ${targets.slice(0, 3).map((t) => `"${t.q}"`).join(" · ")}`);
  if (dryRun) { log("DRY RUN — no requests made, nothing written."); return; }
  if (!targets.length) return;

  // The route must be reachable before walking thousands of rows (0121's rule).
  try {
    const probe = await searchImages("album cover", base);
    if (!probe) { log("REFUSING: the image search answered but returned nothing for a control query."); return; }
  } catch (e) {
    log(`REFUSING: the image search is unreachable (${e.message}) — nothing written.`);
    return;
  }

  let hit = 0, miss = 0, fails = 0, aborted = false;
  const queue = [...targets];
  async function worker() {
    while (queue.length && !aborted) {
      const t = queue.shift();
      try {
        const url = await searchImages(t.q, base);
        fails = 0;
        if (url) { hit++; await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.cover": url, "meta.coverSource": "image-search" } }); }
        else miss++;
      } catch {
        fails++;
        if (fails >= FETCH_FAIL_ABORT) {
          aborted = true;
          log(`REFUSING: ${FETCH_FAIL_ABORT} consecutive requests were REFUSED (not "no result") — stopping. ${hit} written are kept; re-run to continue.`);
        }
      }
      if ((hit + miss) % 200 === 0 && hit + miss) log(`  … ${hit + miss}/${targets.length}  hit=${hit} miss=${miss}`);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`\nimage search: ${hit} written · ${miss} with no result${aborted ? " (ABORTED — throttled)" : ""}`);

  // Songs still inherit, in case an album was filled above.
  const fresh = await Occurrence.find({ gridId }).lean();
  const coverById = new Map(fresh.map((o) => [o.id, o.meta?.cover]));
  let derived = 0;
  for (const s of fresh) {
    if (kindOf(s) !== "song" || s.meta?.cover) continue;
    const c = coverById.get(String(s.fields?.[ALBUM]?.value || ""));
    if (c) { await Occurrence.updateOne({ gridId, id: s.id }, { $set: { "meta.cover": c } }); derived++; }
  }
  log(`songs: ${derived} more inherited their album's art`);
}
