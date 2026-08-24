// utils/providers/itunes.js — podcasts, from Apple's keyless Search API.
//
// Covers the "Podcasts Listened" dropdown, which the grid already tracks and no
// other provider here answers: Wikipedia has articles for a handful of famous
// shows and nothing for the rest, and MusicBrainz does not index podcasts.
//
// ── SCOPED TO PODCASTS, AND THAT IS A MEASUREMENT, NOT A CHOICE ────────────
//
// The same endpoint nominally searches films, and it was the obvious way to
// answer "Movies Watched" better than Wikipedia does (which resolves "Dune" to
// the franchise page). It does not work:
//
//     ?term=dune&entity=movie&limit=3                resultCount 0
//     ?term=dune&media=movie&limit=3&country=US      resultCount 0
//     ?term=hardcore+history&entity=podcast&limit=2  2 results, complete records
//
// Apple has evidently retired store search for films. Registering this provider
// for movies would put a tile in the picker that always returns nothing — the
// class this repo refuses on principle — so it declares podcasts only, and
// films stay with Wikipedia until a keyed film provider is configured.

import { normalizeResult, registerProvider } from "../searchProviders.js";

const SEARCH = "https://itunes.apple.com/search";
// A lookup by id is a DIFFERENT endpoint. `/search?id=…` is not an error —
// it answers 200 with `resultCount: 0`, so the detail step returned null for
// every pick and looked like "this podcast has no details".
const LOOKUP = "https://itunes.apple.com/lookup";
const UA = { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" };

export function podcastFields(r) {
  const f = {};
  if (r?.artistName) f["Publisher"] = r.artistName;
  if (r?.primaryGenreName) f["Genre"] = r.primaryGenreName;
  if (r?.trackCount != null) f["Episodes"] = String(r.trackCount);
  if (r?.releaseDate) f["Latest episode"] = String(r.releaseDate).slice(0, 10);
  if (r?.contentAdvisoryRating) f["Rating"] = r.contentAdvisoryRating;
  if (r?.feedUrl) f["Feed"] = r.feedUrl;
  return f;
}

const toResult = (r) => normalizeResult({
  provider: "itunes",
  externalId: r.trackId ?? r.collectionId,
  title: r.trackName || r.collectionName || "",
  subtitle: [r.artistName, r.primaryGenreName].filter(Boolean).join(" · ") || null,
  thumbnail: r.artworkUrl100 || r.artworkUrl60 || null,
  url: r.trackViewUrl || r.collectionViewUrl || null,
  fields: podcastFields(r),
});

async function call(params, base = SEARCH) {
  const res = await fetch(`${base}?${params}`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  return res.json();
}

export const itunesProvider = {
  id: "itunes", label: "Apple Podcasts", needsKey: false,
  async search(q, { limit = 6 } = {}) {
    const j = await call(`term=${encodeURIComponent(String(q || ""))}&entity=podcast&limit=${limit}`);
    return (j.results || []).map(toResult);
  },
  async detail({ title, externalId } = {}) {
    // A lookup by id is exact; a title falls back to the top search hit, which
    // is the same record the user just picked.
    if (externalId) {
      const j = await call(`id=${encodeURIComponent(externalId)}&entity=podcast`, LOOKUP);
      return j.results?.[0] ? toResult(j.results[0]) : null;
    }
    return (await this.search(title, { limit: 1 }))[0] || null;
  },
};
registerProvider(itunesProvider);
