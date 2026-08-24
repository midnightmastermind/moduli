// utils/providers/musicbrainz.js — albums and singles, from MusicBrainz.
//
// ── MUSICBRAINZ RETURNS EVERY MATCH AT score 100, SO RANKING IS OURS ───────
//
// Measured against the live API: `query=abbey road` puts *Abbey's Road* by Ada
// Montellanico first and never surfaces the Beatles record at all, and asking
// for `releasegroup:"Abbey Road"` returns three results **all scored 100**. The
// score field carries no signal, so sorting by it is sorting by nothing.
//
// Ranked here instead: an EXACT title match first, then the earliest release —
// an original predates the covers and compilations that share its name. It is
// not authority ranking (MusicBrainz exposes none), and it is a large
// improvement over the order the API hands back.

import { normalizeResult, registerProvider } from "../searchProviders.js";

const API = "https://musicbrainz.org/ws/2/release-group/";
// MusicBrainz REQUIRES a contact in the User-Agent and rate-limits to ~1/sec.
const UA = { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" };

export function rankReleaseGroups(groups, query) {
  const q = String(query || "").trim().toLowerCase();
  const year = (g) => (g["first-release-date"] || "9999").slice(0, 4);
  return [...(groups || [])].sort((a, b) => {
    const ax = (a.title || "").toLowerCase() === q, bx = (b.title || "").toLowerCase() === q;
    if (ax !== bx) return ax ? -1 : 1;          // exact title wins
    return year(a).localeCompare(year(b));       // then the earliest release
  });
}

const toResult = (g) => {
  const artist = (g["artist-credit"] || [{}])[0]?.name || null;
  const f = {};
  if (artist) f["Artist"] = artist;
  if (g["first-release-date"]) f["Released"] = g["first-release-date"];
  if (g["primary-type"]) f["Type"] = g["primary-type"];
  if (g["secondary-types"]?.length) f["Secondary types"] = g["secondary-types"].join(", ");
  return normalizeResult({
    provider: "musicbrainz", externalId: g.id, title: g.title || "",
    subtitle: [artist, (g["first-release-date"] || "").slice(0, 4)].filter(Boolean).join(" · ") || null,
    url: g.id ? `https://musicbrainz.org/release-group/${g.id}` : null,
    fields: f,
  });
};

// MusicBrainz's published policy is ONE request per second per client, and it
// answers 503 rather than 429 when you exceed it — which reads like the service
// being down instead of us being impolite. A search followed immediately by a
// detail lookup is two requests, so back-to-back calls tripped it every time.
// Serialised through one chain with a 1.1s spacing, and one retry on a 503.
let gate = Promise.resolve();
const MIN_GAP_MS = 1100;
function throttled(fn) {
  const run = gate.then(fn, fn);
  gate = run.then(() => new Promise((r) => setTimeout(r, MIN_GAP_MS)),
                  () => new Promise((r) => setTimeout(r, MIN_GAP_MS)));
  return run;
}

async function query(lucene, limit) {
  const url = `${API}?query=${encodeURIComponent(lucene)}&fmt=json&limit=${limit}`;
  const once = async () => {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (res.status === 503) { const e = new Error("musicbrainz 503"); e.retryable = true; throw e; }
    if (!res.ok) throw new Error(`musicbrainz ${res.status}`);
    return (await res.json())["release-groups"] || [];
  };
  try { return await throttled(once); }
  catch (e) { if (!e.retryable) throw e; return throttled(once); }
}

// ── TRACKLISTS ────────────────────────────────────────────────────────────
//
// User, 2026-08-24: *"if i liked the album, do all the songs from the album."*
// A Spotify library export lists the tracks you liked INDIVIDUALLY, so a
// starred album arrives with only the handful you happened to like — 81 of the
// 199 arrived with none at all. MusicBrainz is the catalogue that can say what
// the record actually contains.
//
// It goes through the SAME 1-req/sec gate as the search above, because the
// limit is per SERVICE and not per feature. A second client with its own timer
// is how `0054` got two geocoders sharing one queue and paying 2.2s a lookup.

const RELEASE = "https://musicbrainz.org/ws/2/release";

/** Which candidate release to believe. PURE, so the choice is testable dry. */
export function pickRelease(releases, { trackHint = 0 } = {}) {
  const rs = (releases || []).filter((r) => (r?.["track-count"] || 0) > 0);
  if (!rs.length) return null;
  // Prefer the release closest to the track count we expect when we have one;
  // otherwise the SMALLEST, because a deluxe/compilation edition pads a record
  // with alternate takes the user did not ask for. MusicBrainz's own `score`
  // is not used: it ranks title similarity, and every candidate here already
  // has the same title.
  const score = (r) => (trackHint ? Math.abs(r["track-count"] - trackHint) : r["track-count"]);
  return rs.slice().sort((a, b) => score(a) - score(b))[0];
}

/** Every track title on a release, in order. */
export async function releaseTracks(releaseId) {
  const url = `${RELEASE}/${encodeURIComponent(releaseId)}?inc=recordings&fmt=json`;
  const once = async () => {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (res.status === 503) { const e = new Error("musicbrainz 503"); e.retryable = true; throw e; }
    if (!res.ok) throw new Error(`musicbrainz ${res.status}`);
    const j = await res.json();
    return (j.media || []).flatMap((m) => m.tracks || [])
      .map((t) => ({ position: t.position, title: t.title, lengthMs: t.length || null }))
      .filter((t) => t.title);
  };
  try { return await throttled(once); }
  catch (e) { if (!e.retryable) throw e; return throttled(once); }
}

/** Find the release for an album and return its tracks. `[]` when unknown. */
/** The album title WITHOUT its trailing parenthetical qualifier, or null when
 *  there is nothing to strip.
 *
 *  A Spotify export carries qualifiers a MusicBrainz release title does not —
 *  "(Deluxe Edition)", "(Deluxe)", "(feat. Ren)", "(Sugarshack Sessions)".
 *  Measured against the live API on the starred albums that came back empty:
 *
 *      "Parallel Universe (Deluxe Edition)"  0  ->  "Parallel Universe"  14
 *      "Love Is Like (Deluxe)"               0  ->  "Love Is Like"       10
 *      "Baggage (feat. Ren)"                 0  ->  "Baggage"             1
 *      "FUNCTIONAL (Sugarshack Sessions)"    0  ->  "FUNCTIONAL"          0
 *
 *  That last row is the CONTROL: stripping is not a cure-all, and a record
 *  genuinely absent from the catalogue stays absent. PURE. */
export function baseTitle(title) {
  const t = String(title || "").trim();
  // TRAILING only. "(What's the Story) Morning Glory?" opens with one and must
  // keep it — that parenthetical is part of the record's name.
  const m = t.match(/^(.*\S)\s*[([][^()[\]]*[)\]]\s*$/);
  const base = m?.[1]?.trim();
  return base && base !== t ? base : null;
}

/** One release search + tracklist fetch for an EXACT title. */
async function tracksForTitle(title, artist, trackHint) {
  const esc = (v) => String(v || "").replace(/["\\]/g, " ").trim();
  if (!esc(title)) return { tracks: [], releaseId: null };
  const lucene = esc(artist)
    ? `release:"${esc(title)}" AND artist:"${esc(artist)}"`
    : `release:"${esc(title)}"`;
  const url = `${RELEASE}/?query=${encodeURIComponent(lucene)}&fmt=json&limit=5`;
  const once = async () => {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (res.status === 503) { const e = new Error("musicbrainz 503"); e.retryable = true; throw e; }
    if (!res.ok) throw new Error(`musicbrainz ${res.status}`);
    return (await res.json()).releases || [];
  };
  let releases;
  try { releases = await throttled(once); }
  catch (e) { if (!e.retryable) throw e; releases = await throttled(once); }
  const pick = pickRelease(releases, { trackHint });
  if (!pick) return { tracks: [], releaseId: null };
  return { tracks: await releaseTracks(pick.id), releaseId: pick.id };
}

export async function albumTracks(title, artist, { trackHint = 0 } = {}) {
  const exact = await tracksForTitle(title, artist, trackHint);
  if (exact.releaseId) return exact;
  // ONLY once the exact title has found nothing. A record whose real name
  // carries a parenthetical matches on that name above and never gets here, so
  // the fallback cannot rename an album that was already resolving.
  const base = baseTitle(title);
  if (!base) return exact;
  return tracksForTitle(base, artist, trackHint);
}

export const musicBrainzProvider = {
  id: "musicbrainz", label: "MusicBrainz (music)", needsKey: false,
  async search(q, { limit = 6 } = {}) {
    // Over-fetch so the local ranking has something to reorder: taking the API's
    // first 6 and sorting them cannot surface a better 7th.
    const groups = await query(String(q || ""), Math.min(25, limit * 4));
    return rankReleaseGroups(groups, q).slice(0, limit).map(toResult);
  },
  async detail({ title, externalId } = {}) {
    const groups = await query(externalId ? `rgid:${externalId}` : String(title || ""), 1);
    return groups[0] ? toResult(groups[0]) : null;
  },
};
registerProvider(musicBrainzProvider);
