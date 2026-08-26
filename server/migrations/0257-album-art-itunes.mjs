/**
 * 0257 — album art from iTunes, and the songs that inherit it.
 *
 * User, 2026-08-26: *"they need artwork wtf"*.
 *
 * ── WHY `0254` LEFT MOST OF THE MUSIC BLANK ─────────────────────────────
 *
 * `0254` used EXACT identifiers only — a Spotify URL, an ISBN — because an
 * exact id cannot fetch the wrong picture. But the Spotify import stored a URL
 * on just 199 of 3,027 albums, so 24 albums ended up with art. The rest need a
 * SEARCH, and a search is a guess until something constrains it.
 *
 * ── WHAT CONSTRAINS IT: THE ALBUM ALREADY KNOWS ITS ARTIST ──────────────
 *
 * 2,707 of the uncovered albums carry an `Artist` occurrence reference, so the
 * query can be "<album> <artist>" and the ANSWER can be checked against both.
 * Measured on a 30-album sample before writing the migration:
 *
 * ```
 * title + artist both match   22    <- accepted
 * title matched, artist did NOT  0  <- would have been rejected
 * no match                     8
 * errors                       0
 * ```
 *
 * 73%, and — the number that matters — **zero cases where the album title
 * matched but the artist did not**. That is what says the double check is not
 * merely decorative: iTunes' own ranking already agrees with it, so accepting a
 * title-only match would have bought nothing and risked the wrong record.
 *
 * ── SONGS COST NOTHING, AGAIN ───────────────────────────────────────────
 *
 * A song references its Album and a song's artwork IS its album's, so the songs
 * are re-derived after the albums land — no second search, no chance of a song
 * and its album disagreeing.
 *
 * ── ARTISTS ARE STILL BLANK, AND THAT IS DELIBERATE ─────────────────────
 *
 * Probed: iTunes' `musicArtist` entity returns **no artwork at all**. The
 * tempting substitute — use one of their album covers as the artist picture —
 * is exactly the "plausible and wrong" trade `0201` recorded, so the 1,516
 * artists without a Spotify URL stay blank rather than wearing an album sleeve.
 */

export const id = "0257-album-art-itunes";
export const describe =
  "Album art from iTunes for the albums that reference an Artist, accepted only when BOTH the album title and the artist name match; songs then inherit their album's art. Artists are left blank — iTunes has no artist artwork.";
export const touches = ["occurrences"];

export const CONCURRENCY = 5;
export const GAP_MS = 110;
export const FETCH_FAIL_ABORT = 20;

export function normName(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .trim().replace(/\s+/g, " ");
}
export function nameMatches(a, b) {
  const x = normName(a), y = normName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/** iTunes ships a 100px thumbnail; ask the same path for a usable size. */
export function upscale(url) {
  return typeof url === "string" ? url.replace(/\/\d+x\d+bb\./, "/600x600bb.") : null;
}

/** BOTH the album and the artist must match, or nothing is returned. */
export function pickAlbumResult(results, album, artist) {
  for (const r of results || []) {
    if (nameMatches(r.collectionName, album) && nameMatches(r.artistName, artist)) {
      const u = upscale(r.artworkUrl100);
      if (u) return { url: u, collectionName: r.collectionName, artistName: r.artistName };
    }
  }
  return null;
}

export async function findAlbumArt(album, artist, fetchImpl = fetch) {
  const q = `${album} ${artist}`.trim();
  const res = await fetchImpl(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=5`);
  if (!res.ok) return null;
  const js = await res.json();
  return pickAlbumResult(js?.results, album, artist);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
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
    if (kindOf(o) !== "album" || o.meta?.cover) continue;
    const artistOcc = occById.get(String(o.fields?.[ARTIST]?.value || ""));
    if (!artistOcc) continue;
    targets.push({ id: o.id, album: labelOf(o), artist: labelOf(artistOcc) });
  }
  const noArtist = occs.filter((o) => kindOf(o) === "album" && !o.meta?.cover && !occById.get(String(o.fields?.[ARTIST]?.value || ""))).length;
  log(`albums to search: ${targets.length}   (${noArtist} more have no artist reference and are skipped)`);
  if (dryRun) { log("DRY RUN — no requests made, nothing written."); return; }
  if (!targets.length) return;

  let hit = 0, miss = 0, fails = 0, aborted = false;
  const queue = [...targets];
  async function worker() {
    while (queue.length && !aborted) {
      const t = queue.shift();
      try {
        const found = await findAlbumArt(t.album, t.artist);
        fails = 0;
        if (found) { hit++; await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.cover": found.url } }); }
        else miss++;
      } catch {
        fails++; miss++;
        if (fails >= FETCH_FAIL_ABORT) {
          aborted = true;
          log(`REFUSING: ${FETCH_FAIL_ABORT} consecutive requests failed — stopping. ${hit} cover(s) written are kept; re-run to continue.`);
        }
      }
      if ((hit + miss) % 250 === 0) log(`  … ${hit + miss}/${targets.length}  hit=${hit} miss=${miss}`);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`albums: ${hit} written · ${miss} no confident match${aborted ? " (ABORTED)" : ""}`);

  // Songs inherit — read AFTER the fetch so this run's albums count.
  const fresh = await Occurrence.find({ gridId }).lean();
  const coverById = new Map(fresh.map((o) => [o.id, o.meta?.cover]));
  let derived = 0, still = 0;
  for (const s of fresh) {
    if (kindOf(s) !== "song" || s.meta?.cover) continue;
    const c = coverById.get(String(s.fields?.[ALBUM]?.value || ""));
    if (!c) { still++; continue; }
    await Occurrence.updateOne({ gridId, id: s.id }, { $set: { "meta.cover": c } });
    derived++;
  }
  log(`songs: ${derived} inherited their album's art · ${still} whose album still has none`);
}
