// utils/providers/wger.js — exercises, from wger's open catalogue.
//
// User, 2026-08-24: *"workouts should come from a workout feed"* — said right
// after watching Wikipedia answer a Movement dropdown with the generic "Bench
// press" article, and *"i imagined wikipedia for like bookmarks"*. Both are the
// same point: a provider is only useful where its vocabulary IS the field's.
//
// ── IT IS A FEED, NOT A SEARCH — BECAUSE WGER HAS NO SEARCH ────────────────
//
// Measured against the live API before any of this was written:
//
//     ?name=Bench%20Press        count 1      <- EXACT match only
//     ?search=bench              count 3323   <- ignored, returns everything
//     ?name__icontains=bench     count 3323   <- ignored
//     ?language=2                count 3323   <- ALSO ignored (see below)
//     /exercise/search/?term=…   404          <- the documented endpoint is gone
//
// So there is nothing to query per keystroke. The whole English catalogue is
// 3,323 rows, which is small enough to pull ONCE and match locally — and that
// is what makes it a feed in the user's own sense: a catalogue that is pulled,
// not an API that is asked. It also means typing is instant and costs the
// upstream nothing.
//
// ── THE ID TRAP, AND IT WOULD HAVE BEEN SILENT ─────────────────────────────
//
// A translation row's `id` is NOT its exercise's id: "Bench Press" is
// translation 192 of exercise 73, and `/exerciseinfo/192/` answers
// **"No Exercise matches the given query."** Passing the id that is sitting
// right there returns a clean 404 that reads exactly like "this exercise has no
// details", so the detail step would have quietly returned nothing forever. The
// external id is therefore the EXERCISE id, taken from `row.exercise`.
//
// ── `language` IS IGNORED TOO, AND IT SHOWED UP AS GERMAN TEXT ─────────────
//
// The count is 3,323 with no filter, with `language=2`, and with `language=1` —
// the parameter is accepted and does nothing. So the catalogue holds every
// translation, and exercise 73 alone appears as Bankdrücken LH · Bench Press ·
// Distensione Panca Piana · Développé couché · Press de Banca · Wyciskanie
// leżąc. The first row wins a lookup by exercise id, which is how an English
// dropdown came back describing the lift in German. Filtered HERE instead, on
// the row's own `language` field.

import { normalizeResult, registerProvider } from "../searchProviders.js";

const API = "https://wger.de/api/v2";
const UA = { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" };
const ENGLISH = 2;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // the catalogue changes rarely
const PAGE = 500;

let cache = { at: 0, rows: null, loading: null };

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`wger ${res.status}`);
  return res.json();
}

/**
 * The catalogue, fetched once and held for a day.
 * Concurrent callers share ONE in-flight fetch — otherwise the first few
 * keystrokes each start their own full pull of 3,323 rows.
 */
export async function loadCatalogue({ force = false } = {}) {
  if (!force && cache.rows && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  if (cache.loading) return cache.loading;

  cache.loading = (async () => {
    const rows = [];
    let url = `${API}/exercise-translation/?language=${ENGLISH}&format=json&limit=${PAGE}`;
    // Bounded: a paging bug upstream must not spin forever on the server.
    for (let page = 0; url && page < 20; page++) {
      const j = await getJson(url);
      for (const r of j.results || []) {
        if (!r?.name || !r?.exercise) continue;
        if (r.language !== ENGLISH) continue;   // the API's own filter does nothing
        rows.push({ name: r.name, exerciseId: r.exercise, description: r.description || "" });
      }
      url = j.next || null;
    }
    cache = { at: Date.now(), rows, loading: null };
    return rows;
  })();

  try { return await cache.loading; }
  catch (e) { cache.loading = null; throw e; }
}

/** Strip the HTML wger stores descriptions in — it is shown as a subtitle. */
function plain(html, max = 120) {
  const t = String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Rank: a name that STARTS with the query beats one that merely contains it. */
export function rankMatches(rows, term, limit) {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const starts = [], contains = [];
  for (const r of rows) {
    const n = r.name.toLowerCase();
    if (n.startsWith(q)) starts.push(r);
    else if (n.includes(q)) contains.push(r);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

export const wgerProvider = {
  id: "wger",
  label: "wger (exercises)",
  needsKey: false,

  async search(query, { limit = 6 } = {}) {
    const rows = await loadCatalogue();
    return rankMatches(rows, String(query || ""), limit).map((r) => normalizeResult({
      provider: "wger",
      externalId: r.exerciseId,          // the EXERCISE id, never the translation's
      title: r.name,
      subtitle: plain(r.description) || null,
      url: `https://wger.de/en/exercise/${r.exerciseId}/view/`,
    }));
  },

  async detail({ title, externalId } = {}) {
    let id = externalId;
    if (!id && title) {
      const rows = await loadCatalogue();
      id = rows.find((r) => r.name.toLowerCase() === String(title).toLowerCase())?.exerciseId;
    }
    if (!id) return null;

    const info = await getJson(`${API}/exerciseinfo/${encodeURIComponent(id)}/?format=json`);
    const names = (list) => (list || []).map((m) => m?.name_en || m?.name).filter(Boolean).join(", ");

    // Field NAMES are wger's own vocabulary, because the mapping UI shows the
    // user exactly what the provider returned and asks where each goes.
    const fields = {};
    if (info?.category?.name) fields["Category"] = info.category.name;
    if (names(info?.muscles)) fields["Muscles"] = names(info.muscles);
    if (names(info?.muscles_secondary)) fields["Secondary muscles"] = names(info.muscles_secondary);
    if (names(info?.equipment)) fields["Equipment"] = names(info.equipment);

    const rows = await loadCatalogue().catch(() => []);
    const row = rows.find((r) => String(r.exerciseId) === String(id));
    if (row?.description) fields["Description"] = plain(row.description, 400);

    return normalizeResult({
      provider: "wger",
      externalId: id,
      title: title || row?.name || `Exercise ${id}`,
      subtitle: fields["Category"] || null,
      thumbnail: info?.images?.[0]?.image || null,
      url: `https://wger.de/en/exercise/${id}/view/`,
      fields,
    });
  },
};

registerProvider(wgerProvider);
