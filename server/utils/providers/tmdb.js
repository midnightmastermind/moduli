// utils/providers/tmdb.js — films, from The Movie Database.
//
// User, 2026-08-24, choosing it over Wikipedia for films: *"Add TMDB, I'll get a
// key."* Wikipedia answers a film title with an encyclopedia article, which is
// excellent for The Matrix (16 infobox fields) and wrong for "Dune", where the
// top hit is the franchise page and the film is three results down. TMDB is a
// film index: it disambiguates a film from its franchise by construction and
// returns the director and cast as data rather than as prose in a table.
//
// ── IT IS INVISIBLE UNTIL A KEY EXISTS, AND THAT IS THE POINT ──────────────
//
// `requiresEnv` makes `availableProviders` drop it from the picker entirely when
// `TMDB_API_KEY` is unset — so a deployment without a key never offers a tile
// that cannot work, and the failure lands at configuration instead of at the
// user's keystroke. Wikipedia stays available for films either way, so nothing
// regresses while the key is being obtained.
//
// **Get a key:** themoviedb.org → Settings → API → request a v3 key (free,
// instant for personal use), then put `TMDB_API_KEY=…` in `server/.env` and
// restart. The picker gains "TMDB (films)" on the next load; nothing else needs
// to change.

import { normalizeResult, registerProvider } from "../searchProviders.js";

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w342";
const UA = { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" };

async function call(path, params, env = process.env) {
  const key = env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set");
  const res = await fetch(`${API}${path}?api_key=${encodeURIComponent(key)}&${params}`,
    { headers: UA, signal: AbortSignal.timeout(20000) });
  if (res.status === 401) throw new Error("TMDB rejected the key");
  if (!res.ok) throw new Error(`tmdb ${res.status}`);
  return res.json();
}

/** A detail payload -> the fields worth offering. Pure, so it tests without a key. */
export function filmFields(d) {
  const f = {};
  const crew = d?.credits?.crew || [], cast = d?.credits?.cast || [];
  const directors = crew.filter((c) => c.job === "Director").map((c) => c.name);
  if (directors.length) f["Director"] = directors.join(", ");
  const writers = crew.filter((c) => c.department === "Writing").map((c) => c.name);
  if (writers.length) f["Writer"] = [...new Set(writers)].slice(0, 3).join(", ");
  if (cast.length) f["Cast"] = cast.slice(0, 5).map((c) => c.name).join(", ");
  if (d?.release_date) f["Released"] = d.release_date;
  // Runtime is a bare NUMBER of minutes here, unlike Wikipedia's "148 minutes",
  // so it lands in a duration field without the mapper having to parse prose.
  if (d?.runtime) f["Runtime"] = String(d.runtime);
  if (d?.genres?.length) f["Genres"] = d.genres.map((g) => g.name).join(", ");
  if (d?.vote_average) f["Rating"] = String(Math.round(d.vote_average * 10) / 10);
  if (d?.tagline) f["Tagline"] = d.tagline;
  return f;
}

const toResult = (m, fields = {}) => normalizeResult({
  provider: "tmdb",
  externalId: m.id,
  title: m.title || m.original_title || "",
  subtitle: [(m.release_date || "").slice(0, 4), m.overview?.slice(0, 60)].filter(Boolean).join(" · ") || null,
  thumbnail: m.poster_path ? `${IMG}${m.poster_path}` : null,
  url: m.id ? `https://www.themoviedb.org/movie/${m.id}` : null,
  fields,
});

export const tmdbProvider = {
  id: "tmdb", label: "TMDB (films)", needsKey: true, requiresEnv: "TMDB_API_KEY",
  async search(q, { limit = 6 } = {}) {
    const j = await call("/search/movie", `query=${encodeURIComponent(String(q || ""))}&include_adult=false`);
    // TMDB's own popularity ordering already puts the film ahead of its
    // also-titled documentaries, so this does NOT re-rank — unlike MusicBrainz,
    // whose scores carry no signal at all.
    return (j.results || []).slice(0, limit).map((m) => toResult(m));
  },
  async detail({ title, externalId } = {}) {
    let id = externalId;
    if (!id && title) {
      const j = await call("/search/movie", `query=${encodeURIComponent(title)}&include_adult=false`);
      id = j.results?.[0]?.id;
    }
    if (!id) return null;
    // `append_to_response` folds the credits into the SAME request — director
    // and cast otherwise cost a second round trip per pick.
    const d = await call(`/movie/${encodeURIComponent(id)}`, "append_to_response=credits");
    return toResult(d, filmFields(d));
  },
};
registerProvider(tmdbProvider);
