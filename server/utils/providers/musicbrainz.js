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
