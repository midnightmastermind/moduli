/**
 * 0245 — the movie and TV rows get their posters, from TMDB.
 *
 * User, 2026-08-25: *"the movie images still arent showing up"* → *"search for
 * those using tmdb"*.
 *
 * ── THEY WERE NEVER MISSING, THEY NEVER EXISTED ──────────────────────────
 *
 * Measured before writing anything: every one of the 993 movie rows is a
 * `role:"artifact" kind:"movie"` occurrence with **`fileRef: null`**. `0238`
 * imported titles from media.md, which carries no artwork — the same gap the
 * Spotify and Calibre imports have. So the card had nothing to draw and fell
 * back to its alt text, which is the word "Movie" the user kept seeing.
 *
 * ── THE COVER GOES ON THE OCCURRENCE, AND THAT IS THE WHOLE TRAP ─────────
 *
 * `0201` put bookmark covers on the MODULE, and that was right there: a
 * bookmark has one module per bookmark. This import does not.
 *
 * ```
 * artifact modules by kind:   movie 1 · series 1 · game 1 · comic 1
 * occurrences:                movie 993 · series 187
 * ```
 *
 * ONE SHARED MODULE PER KIND. A cover on the module would give all 993 films
 * the same poster — a change that looks like it worked until you scroll. So it
 * is written per OCCURRENCE, and `ArtifactCard` now prefers
 * `occurrence.meta.cover` over `module.meta.cover` (per-placement beats
 * template, exactly as it already does for field bindings, view mode and
 * styles; `PreviewNode` reads the same key for its own per-card override). The
 * module fallback is what keeps the 1,467 bookmarks working.
 *
 * ── TITLES ARE FILENAMES, AND ONE CHARACTER FIXES MOST OF IT ─────────────
 *
 * media.md titles came off a disk, so a colon is an underscore:
 * `The Hobbit_ The Desolation of Smaug`, `2001_ A Space Odyssey`,
 * `Home Alone 2_ Lost in New York`. Replacing `_` with a space and letting
 * TMDB's fuzzy match do the rest scored **13 of 14 on a deliberately hard
 * sample** (the miss is `Harmontown`, a documentary that is not a TV series —
 * a real miss, not a parsing failure).
 *
 * ── THE YEAR IS A HINT, NOT A FILTER ─────────────────────────────────────
 *
 * `0238` put the year in its own field precisely because for a film the year
 * is identity (`The Ring` 2002 vs 1927). 864 of 993 movies carry one; only 14
 * of 187 series do. So it is passed when present and the search is RETRIED
 * WITHOUT IT when the year-scoped query finds nothing — a wrong year in the
 * filename must not cost the poster.
 *
 * ── THE ABORT GUARD KEYS ON FETCH FAILURES, NEVER ON MISSES ──────────────
 *
 * `0201` recorded getting this exactly backwards: counting MISSES made the
 * guard unfireable, because a miss is the normal case for obscure titles. A
 * dead key or no network shows up as a FETCH failure, so that is what is
 * counted: if the first 20 requests all fail to reach TMDB, the run refuses
 * rather than walking 1,180 titles to write nothing.
 *
 * Resumable by construction: a row that already has a cover is never fetched,
 * so a run that dies at 400 leaves 400 done and the next pass starts there.
 *
 * **Games and comics are deliberately skipped** — TMDB indexes neither, and
 * offering a film's poster for a game is worse than a blank box.
 */
export const id = "0245-tmdb-covers";
export const describe =
  "Fetches movie and TV posters from TMDB and stamps them on each occurrence as meta.cover. Resumable; refuses if TMDB is unreachable. Games and comics are skipped.";
export const touches = ["occurrences"];

const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const KIND_ENDPOINT = { movie: "movie", series: "tv" };
const FETCH_FAIL_ABORT = 20;   // consecutive unreachable requests before refusing
const CONCURRENCY = 4;
const GAP_MS = 60;

// Quality / source / codec tokens that mark where a RELEASE NAME stops being
// a title. Matched whole-segment, so a film called "Web" or "Proper" is safe.
const RELEASE_TOKEN = /^(?:\d{3,4}p|2160p|4k|uhd|bluray|blu-ray|bdrip|brrip|webrip|web|web-dl|hdtv|dvdrip|remux|x264|x265|h264|h\.?264|h265|hevc|10bit|hdr|dd5|ddp|ac3|aac|dts|atmos|opus|amzn|hmax|pmtp|nf|repack|proper|extended|unrated|internal|multi|dual)$/i;

/**
 * media.md titles are FILENAMES, in two shapes.
 *
 * 1. `_` stands in for a colon — `The Hobbit_ The Desolation of Smaug`.
 * 2. A raw RELEASE NAME, dot-separated with no spaces:
 *    `Guardians.Of.The.Galaxy.Vol.3.2023.2160p.UHD.BDRIP.x265.10bit.HDR.AC3-AOC`.
 *    The first pass matched 1,156 of 1,180 and **every one of the 24 misses was
 *    this second shape** — so it is handled rather than written off.
 *
 * The release branch is gated on "no spaces AND at least two dots", so an
 * ordinary title containing a full stop cannot be shredded by it. Verified
 * against all 24 real misses plus the normal shapes as controls: 8 of 8
 * cleaned, 5 of 5 unchanged.
 */
export function cleanTitle(raw) {
  let t = String(raw || "").replace(/^_?UNPACK_?/i, "").trim();
  if (!/\s/.test(t) && (t.match(/\./g) || []).length >= 2) {
    const parts = t.split(".");
    const out = [];
    for (const p of parts) {
      if (/^(19|20)\d{2}$/.test(p)) break;   // the year ends the title
      if (RELEASE_TOKEN.test(p)) break;       // …or the first quality token
      out.push(p);
    }
    t = (out.length ? out : parts).join(" ");
  }
  return t
    .replace(/_/g, " ")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A release name carries its own year, and it is more trustworthy than an
 * EMPTY `Year` field — 129 movies and 173 series have none. Used only as a
 * fallback, so a curated Year always wins.
 */
export function yearFromTitle(raw) {
  const m = String(raw || "").match(/[.\s(](19|20)\d{2}[.\s)]/);
  return m ? Number(m[0].replace(/\D/g, "")) : 0;
}

export function posterUrl(path) {
  return path ? `${IMG_BASE}${path}` : null;
}

/**
 * One title -> a poster URL, or null.
 * Throws ONLY when TMDB could not be reached — the caller separates "no match"
 * (normal, common) from "the service is gone" (abort-worthy).
 */
export async function findPoster({ title, year, endpoint, key, fetchImpl = fetch }) {
  const q = encodeURIComponent(title);
  const yearParam = year > 0
    ? (endpoint === "tv" ? `&first_air_date_year=${year}` : `&year=${year}`)
    : "";
  const attempts = yearParam ? [yearParam, ""] : [""];
  for (const yp of attempts) {
    const res = await fetchImpl(
      `https://api.themoviedb.org/3/search/${endpoint}?api_key=${key}&query=${q}${yp}`
    );
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    const json = await res.json();
    const hit = (json.results || []).find((r) => r.poster_path);
    if (hit) return { url: posterUrl(hit.poster_path), matched: hit.title || hit.name };
  }
  return null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const key = process.env.TMDB_API_KEY;
  if (!key) { log("REFUSING: TMDB_API_KEY is not set — nothing written."); return; }

  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const yearFieldId = fields.find((f) => f.name === "Year")?.id || null;

  const targets = [];
  for (const o of occs) {
    const kind = modById.get(o.moduleId)?.kind;
    const endpoint = KIND_ENDPOINT[kind];
    if (!endpoint) continue;
    if (o.meta?.cover) continue;                       // resumable
    const raw = o.label ?? modById.get(o.moduleId)?.label;
    const title = cleanTitle(raw);
    if (!title) continue;
    targets.push({
      id: o.id, title, raw, endpoint,
      year: (yearFieldId ? Number(o.fields?.[yearFieldId]?.value) || 0 : 0) || yearFromTitle(raw),
    });
  }

  const already = occs.filter((o) => KIND_ENDPOINT[modById.get(o.moduleId)?.kind] && o.meta?.cover).length;
  log(`${targets.length} row(s) need a poster (${already} already have one).`);
  const byKind = targets.reduce((a, t) => ((a[t.endpoint] = (a[t.endpoint] || 0) + 1), a), {});
  log(`  by endpoint: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  if (dryRun) { log("DRY RUN — no requests made, nothing written."); return; }
  if (!targets.length) return;

  let hit = 0, miss = 0, consecutiveFetchFails = 0, aborted = false;
  const queue = [...targets];

  async function worker() {
    while (queue.length && !aborted) {
      const t = queue.shift();
      try {
        const found = await findPoster({ title: t.title, year: t.year, endpoint: t.endpoint, key });
        consecutiveFetchFails = 0;
        if (found) {
          hit++;
          // PATH-SET, never a whole-meta write — an occurrence carries more
          // than this key and a wholesale write would drop the rest.
          await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.cover": found.url } });
        } else {
          miss++;
        }
      } catch {
        consecutiveFetchFails++;
        miss++;
        if (consecutiveFetchFails >= FETCH_FAIL_ABORT) {
          aborted = true;
          log(`REFUSING: ${FETCH_FAIL_ABORT} consecutive requests could not reach TMDB — stopping. ${hit} poster(s) already written are kept; re-run to continue.`);
        }
      }
      if ((hit + miss) % 100 === 0) log(`  … ${hit + miss}/${targets.length}  hit=${hit} miss=${miss}`);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`\ndone: ${hit} poster(s) written, ${miss} without a match${aborted ? " (ABORTED early)" : ""}.`);
}
