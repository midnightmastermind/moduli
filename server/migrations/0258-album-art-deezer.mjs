/**
 * 0258 — album art from Deezer, after iTunes throttled `0257` into a wall.
 *
 * ── WHAT WENT WRONG IN `0257`, AND IT IS A GUARD BUG, NOT A SOURCE BUG ──
 *
 * `0257` measured 22/30 on a sample and then wrote **37 covers out of 2,707**.
 * The hit count froze at 37 within the first thousand rows and never moved.
 * Checked immediately afterwards:
 *
 * ```
 * itunes.apple.com/search?... -> HTTP 403   (three attempts, all 403)
 * ```
 *
 * iTunes rate-limited after roughly forty requests and `0257` walked the
 * remaining 2,670 albums against a closed door, writing nothing.
 *
 * **It did that because its abort guard keyed on THROWN errors.** A 403 does not
 * throw — `res.ok` is false, the helper returns null, and null is the same value
 * a genuine "no album by that name" produces. So every refusal was counted as a
 * MISS and the guard could never fire. `0201` records this exact class from the
 * other direction ("counting MISSES made the guard UNFIREABLE"); the lesson is
 * that the two outcomes must be DIFFERENT VALUES, not the same null.
 *
 * Here `findAlbumArt` THROWS on a non-ok response, so throttling trips the abort
 * and the run stops loudly instead of quietly achieving nothing.
 *
 * ── DEEZER, MEASURED BEFORE SWITCHING ───────────────────────────────────
 *
 * ```
 * search "Black Sunday Cypress Hill" -> Black Sunday · Cypress Hill · cover_xl
 * 12 rapid requests                  -> 12x HTTP 200, no throttling
 * ```
 * No key, returns the artist alongside the title (so the same double check
 * applies), and ships `cover_xl` — a real image rather than a 100px thumbnail
 * that has to be string-rewritten.
 *
 * The match rule is unchanged and is imported from `0257` rather than restated:
 * BOTH the album title and the artist name must match, and a title-only hit is
 * refused.
 *
 * Songs re-derive from their album afterwards, as before. Albums that `0257`
 * already covered are skipped, so this resumes rather than repeats.
 */
import { nameMatches } from "./0257-album-art-itunes.mjs";

export const id = "0258-album-art-deezer";
export const describe =
  "Album art from Deezer for albums that reference an Artist, accepted only when the title AND artist match; songs inherit. Replaces 0257, whose abort guard could not see iTunes' 403s and so wrote 37 of 2,707.";
export const touches = ["occurrences"];

export const CONCURRENCY = 4;
export const GAP_MS = 350;
export const FETCH_FAIL_ABORT = 15;

export function pickDeezerAlbum(data, album, artist) {
  for (const r of data || []) {
    if (nameMatches(r?.title, album) && nameMatches(r?.artist?.name, artist)) {
      const u = r.cover_xl || r.cover_big || r.cover_medium;
      if (typeof u === "string" && /^https?:\/\//.test(u)) return { url: u, title: r.title, artist: r.artist?.name };
    }
  }
  return null;
}

/**
 * THROWS on a refused request. That distinction is the whole point of this
 * migration: a throttled endpoint must not look like an album nobody has.
 */
export async function findAlbumArt(album, artist, fetchImpl = fetch) {
  const q = `${album} ${artist}`.trim();
  const res = await fetchImpl(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`);
  if (!res.ok) throw new Error(`deezer ${res.status}`);
  const js = await res.json();
  if (js && js.error && Object.keys(js.error).length) throw new Error("deezer error payload");
  return pickDeezerAlbum(js?.data, album, artist);
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
    const a = occById.get(String(o.fields?.[ARTIST]?.value || ""));
    if (a) targets.push({ id: o.id, album: labelOf(o), artist: labelOf(a) });
  }
  log(`albums still without art that reference an artist: ${targets.length}`);
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
        fails++;
        if (fails >= FETCH_FAIL_ABORT) {
          aborted = true;
          log(`REFUSING: ${FETCH_FAIL_ABORT} consecutive requests were REFUSED (not "no match") — the service is throttling. ${hit} cover(s) written are kept; re-run later to continue.`);
        }
      }
      if ((hit + miss) % 250 === 0 && hit + miss) log(`  … ${hit + miss}/${targets.length}  hit=${hit} miss=${miss}`);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`albums: ${hit} written · ${miss} no confident match${aborted ? " (ABORTED — throttled)" : ""}`);

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
