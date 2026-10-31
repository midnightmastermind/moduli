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

// The key: the user's (Command Center › Imports › Search sources), else TMDB_API_KEY — resolved by the route
// and handed in as `key`. A direct call with neither still says which key is missing.
async function call(path, params, key = process.env.TMDB_API_KEY) {
  if (!key) throw new Error("TMDB_API_KEY is not set and no TMDB key was given");
  const res = await fetch(`${API}${path}?api_key=${encodeURIComponent(key)}&${params}`,
    { headers: UA, signal: AbortSignal.timeout(20000) });
  if (res.status === 401) throw new Error("TMDB rejected the key");
  if (!res.ok) throw new Error(`tmdb ${res.status}`);
  return res.json();
}

const TMDB_KEY = { id: "tmdb", env: "TMDB_API_KEY", label: "TMDB API key (v3)",
  getUrl: "https://www.themoviedb.org/settings/api" };

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
  id: "tmdb", label: "TMDB (films)", needsKey: true, apiKey: TMDB_KEY,
  async search(q, { limit = 6, key } = {}) {
    const j = await call("/search/movie", `query=${encodeURIComponent(String(q || ""))}&include_adult=false`, key);
    // TMDB's own popularity ordering already puts the film ahead of its
    // also-titled documentaries, so this does NOT re-rank — unlike MusicBrainz,
    // whose scores carry no signal at all.
    return (j.results || []).slice(0, limit).map((m) => toResult(m));
  },
  async detail({ title, externalId } = {}, { key } = {}) {
    let id = externalId;
    if (!id && title) {
      const j = await call("/search/movie", `query=${encodeURIComponent(title)}&include_adult=false`, key);
      id = j.results?.[0]?.id;
    }
    if (!id) return null;
    // `append_to_response` folds the credits into the SAME request — director
    // and cast otherwise cost a second round trip per pick.
    const d = await call(`/movie/${encodeURIComponent(id)}`, "append_to_response=credits", key);
    return toResult(d, filmFields(d));
  },
};
registerProvider(tmdbProvider);

// ── TV (user, 2026-10-31: "TMDB should be for tv search too") — the same account and key as films.

/** A TV detail payload -> the fields worth offering. Pure. */
export function showFields(d) {
  const f = {};
  if (d?.created_by?.length) f["Created by"] = d.created_by.map((c) => c.name).join(", ");
  const cast = d?.credits?.cast || [];
  if (cast.length) f["Cast"] = cast.slice(0, 5).map((c) => c.name).join(", ");
  if (d?.first_air_date) f["First aired"] = d.first_air_date;
  if (d?.last_air_date) f["Last aired"] = d.last_air_date;
  if (d?.number_of_seasons) f["Seasons"] = String(d.number_of_seasons);
  if (d?.number_of_episodes) f["Episodes"] = String(d.number_of_episodes);
  if (d?.episode_run_time?.length) f["Runtime"] = String(d.episode_run_time[0]);
  if (d?.genres?.length) f["Genres"] = d.genres.map((g) => g.name).join(", ");
  if (d?.networks?.length) f["Network"] = d.networks.map((n) => n.name).join(", ");
  if (d?.status) f["Status"] = d.status;
  if (d?.vote_average) f["Rating"] = String(Math.round(d.vote_average * 10) / 10);
  if (d?.tagline) f["Tagline"] = d.tagline;
  return f;
}

const toShow = (m, fields = {}) => normalizeResult({
  provider: "tmdb-tv",
  externalId: m.id,
  title: m.name || m.original_name || "",
  subtitle: [(m.first_air_date || "").slice(0, 4), m.overview?.slice(0, 60)].filter(Boolean).join(" · ") || null,
  thumbnail: m.poster_path ? `${IMG}${m.poster_path}` : null,
  url: m.id ? `https://www.themoviedb.org/tv/${m.id}` : null,
  fields,
});

/** One season's episodes, in order: [{ season, episode, title, airDate, runtime, overview, still }]. */
export async function seasonEpisodes(showId, season, { key } = {}) {
  const j = await call(`/tv/${encodeURIComponent(showId)}/season/${encodeURIComponent(season)}`, "", key);
  return (j.episodes || []).map((e) => ({
    season: e.season_number, episode: e.episode_number, title: e.name || "",
    airDate: e.air_date || null, runtime: e.runtime || null, overview: e.overview || "",
    still: e.still_path ? `${IMG}${e.still_path}` : null,
  }));
}

export const tmdbTvProvider = {
  id: "tmdb-tv", label: "TMDB (TV)", needsKey: true, apiKey: TMDB_KEY,
  async search(q, { limit = 6, key } = {}) {
    const j = await call("/search/tv", `query=${encodeURIComponent(String(q || ""))}&include_adult=false`, key);
    return (j.results || []).slice(0, limit).map((m) => toShow(m));
  },
  async detail({ title, externalId } = {}, { key } = {}) {
    let id = externalId;
    if (!id && title) {
      const j = await call("/search/tv", `query=${encodeURIComponent(title)}&include_adult=false`, key);
      id = j.results?.[0]?.id;
    }
    if (!id) return null;
    const d = await call(`/tv/${encodeURIComponent(id)}`, "append_to_response=credits", key);
    return toShow(d, showFields(d));
  },
};
registerProvider(tmdbTvProvider);
