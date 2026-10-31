// services/tvEpisodes.js — every TV show's episodes on the Episodes board (user, 2026-10-31: "an episodes board that
// we prefill for now, that uses an operation for future ones that it adds the episodes to the episodes board";
// answers: all 187 shows, a daily check).
//
// The board is found by its container's identitySignature `tv:episodes` (migration 0472 makes it). An episode row
// carries TV Show (the show's occurrence), Season, Episode #, Air Date and Board Category `episode`, and
// `meta.episodeKey = tmdb:<show>:<season>:<episode>` — that key is what makes a re-run add only what is new.
//
// FINDING THE SHOW ON TMDB. A show row holds no TMDB id, only a name, a Year and (183 of 187) a TMDB poster URL.
// So the search result whose poster IS the row's poster wins; then one whose first-air year is the row's Year; then
// the first result. How each was matched is reported, and the id is kept on the row (`meta.tmdbId`) so it is
// searched once. An Ended/Canceled show is not re-fetched after its first full read (`meta.tmdbStatus`).
import { randomUUID, createHash } from "node:crypto";

export const EPISODES_SIGNATURE = "tv:episodes";
export const SEASONS_SIGNATURE = "tv:seasons";   // migration 0473 — optional: without it no seasons are kept
export const FIELD_NAMES = { show: "TV Show", season: "Season", number: "Episode #", airDate: "Air Date", category: "Board Category",
  seasonLink: "TV Season", episodeList: "Episode List" };
const FINISHED = new Set(["Ended", "Canceled"]);

const posterPath = (url) => (String(url || "").match(/\/t\/p\/[^/]+(\/[^/?#]+)$/) || [])[1] || null;
const valueOf = (cell) => (cell && typeof cell === "object" && "value" in cell ? cell.value : cell);

/** Which TMDB search result is this show row. Pure. -> { result, by: "poster"|"year"|"first" } or null. */
export function matchShow(results, show) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return null;
  const poster = posterPath(show?.meta?.cover);
  if (poster) {
    const hit = list.find((r) => r.poster_path === poster);
    if (hit) return { result: hit, by: "poster" };
  }
  const year = Number(show?.year) || null;
  if (year) {
    const hit = list.find((r) => Number(String(r.first_air_date || "").slice(0, 4)) === year);
    if (hit) return { result: hit, by: "year" };
  }
  // TMDB's top result only when it carries the show's own name ("Dark" must not become "Dark Shadows", and a
  // folder-named row "Season 9" must not become someone's season 9). A trailing "(US)" on the row is ignored.
  const name = (v) => String(v || "").replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const want = name(show?.label);
  if (want && name(list[0].name || list[0].original_name) === want) return { result: list[0], by: "first" };
  return null;
}

export const episodeKey = (tmdbId, season, number) => `tmdb:${tmdbId}:${season}:${number}`;
const pad = (n) => String(n).padStart(2, "0");
export const seasonKey = (sourceId, season) => `${sourceId}:${season}`;
export const seasonLabel = (showLabel, n) => `${showLabel || "Show"} — Season ${n}`;
export const episodeLabel = (e) => `S${pad(e.season)}E${pad(e.episode)}${e.title ? ` · ${e.title}` : ""}`;

/** The episode rows to add for one show. Pure: `existingKeys` is a Set of episodeKeys already on the board. */
export function planEpisodeRows({ show, tmdbId, episodes, existingKeys, fieldIds, moduleId, containerId, userId, gridId, newId = randomUUID, seasonIdOf = () => null }) {
  const rows = [];
  for (const e of episodes || []) {
    if (!(e.season > 0) || !(e.episode > 0)) continue; // season 0 = specials
    const key = e.key || episodeKey(tmdbId, e.season, e.episode);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const fields = {
      [fieldIds.show]: { value: show.id, flow: "in" },
      [fieldIds.season]: { value: e.season, flow: "in" },
      [fieldIds.number]: { value: e.episode, flow: "in" },
      [fieldIds.category]: { value: ["episode"], flow: "in" },
    };
    if (e.airDate && fieldIds.airDate) fields[fieldIds.airDate] = { value: e.airDate, flow: "in" };
    const seasonId = seasonIdOf(e.season);
    if (seasonId && fieldIds.seasonLink) fields[fieldIds.seasonLink] = { value: seasonId, flow: "in" };
    rows.push({
      id: newId(), userId, gridId, moduleId, parentId: containerId, label: episodeLabel(e), fields, occurrences: [],
      meta: { episodeKey: key, ...(e.still ? { cover: e.still } : {}) },
    });
  }
  return rows;
}

/**
 * The season rows a show's new episodes need, and which existing seasons gain episodes. Pure.
 * -> { newRows, idOf(season), appends: [{ id, add: [episodeIds] }] } — call after planEpisodeRows with its rows.
 */
export function planSeasons({ show, sourceId, seasonsNeeded, seasonRows, fieldIds, moduleId, containerId, userId, gridId, newId = randomUUID }) {
  const newRows = [], ids = {};
  for (const n of [...new Set(seasonsNeeded)].sort((a, b) => a - b)) {
    const key = seasonKey(sourceId, n);
    const have = seasonRows.get(key);
    if (have) { ids[n] = have.id; continue; }
    const row = { id: newId(), userId, gridId, moduleId, parentId: containerId, label: seasonLabel(show.label, n), occurrences: [],
      fields: { [fieldIds.show]: { value: show.id, flow: "in" }, [fieldIds.season]: { value: n, flow: "in" },
        [fieldIds.category]: { value: ["season"], flow: "in" }, [fieldIds.episodeList]: { value: [], flow: "in" } },
      meta: { seasonKey: key, ...(show.meta?.cover ? { cover: show.meta.cover } : {}) } };
    newRows.push(row); seasonRows.set(key, row); ids[n] = row.id;
  }
  return { newRows, idOf: (n) => ids[n] || null };
}

/** Everything the sync needs off the grid: the board, the fields, the episode module, the shows, the keys present. */
export async function loadEpisodeContext({ gridId, models }) {
  const { Field, Occurrence } = models;
  const container = await Occurrence.findOne({ gridId, identitySignature: EPISODES_SIGNATURE }).lean();
  if (!container) throw Object.assign(new Error("no Episodes board (run migration 0472)"), { status: 404 });
  const fields = await Field.find({ gridId, trashed: { $ne: true } }).lean();
  const pick = (name, type) => fields.find((f) => f.name === name && f.type === type && !f.displayEnabled)?.id;
  const fieldIds = {
    show: pick(FIELD_NAMES.show, "occurrence"), season: pick(FIELD_NAMES.season, "number"),
    number: pick(FIELD_NAMES.number, "number"), airDate: pick(FIELD_NAMES.airDate, "date"),
    category: pick(FIELD_NAMES.category, "select"), year: pick("Year", "number"),
    seasonLink: pick(FIELD_NAMES.seasonLink, "occurrence"), episodeList: pick(FIELD_NAMES.episodeList, "occurrence"),
  };
  for (const k of ["show", "season", "number", "category"]) if (!fieldIds[k]) throw new Error(`no "${FIELD_NAMES[k]}" field`);
  const rows = await Occurrence.find({ gridId, "meta.episodeKey": { $exists: true } }, { "meta.episodeKey": 1, moduleId: 1 }).lean();
  // Show rows: tagged "series", not feed copies, and not a board (the TV Series board carries the tag for its "+ Add").
  const shows = await Occurrence.find({ gridId, [`fields.${fieldIds.category}.value`]: "series", "meta.feedSourceId": { $exists: false }, "feed.enabled": { $ne: true } }).lean();
  const seasonsBoard = fieldIds.seasonLink && fieldIds.episodeList ? await Occurrence.findOne({ gridId, identitySignature: SEASONS_SIGNATURE }).lean() : null;
  const seasonRows = new Map();
  if (seasonsBoard) for (const r of await Occurrence.find({ gridId, "meta.seasonKey": { $exists: true } }, { id: 1, "meta.seasonKey": 1, moduleId: 1 }).lean()) seasonRows.set(r.meta.seasonKey, r);
  const lastSeason = {};   // tmdb show id -> highest season already on the board
  for (const r of rows) { const [, show, season] = String(r.meta.episodeKey).split(":"); lastSeason[show] = Math.max(lastSeason[show] || 0, Number(season) || 0); }
  return {
    container, fieldIds, shows, lastSeason, seasonsBoard, seasonRows,
    seasonModuleId: [...seasonRows.values()][0]?.moduleId || seasonsBoard?.meta?.seasonModuleId || null,
    existingKeys: new Set(rows.map((r) => r.meta.episodeKey)),
    moduleId: rows[0]?.moduleId || container.meta?.episodeModuleId || null,
  };
}

/** One show: its TMDB id (search once), status, and every season's episodes. `tmdb` = { search, show, season }. */
export async function fetchShow(show, ctx, tmdb) {
  // A show whose episodes only a podcast feed lists (Harmontown — a video podcast, still a TV show): its feed is the episode list — one season, numbered oldest first, keyed by the
  // item's guid so a re-read adds only what is new.
  if (show.meta?.podcastFeed) {
    const { parseNewsFeed } = await import("./feeds.js");
    const { items } = parseNewsFeed(await tmdb.feed(show.meta.podcastFeed));
    const sourceId = `rss:${show.id}`;
    const episodes = [...items].reverse().map((it, i) => ({ season: 1, episode: i + 1, title: it.title || "",
      airDate: it.publishedAt ? new Date(it.publishedAt).toISOString().slice(0, 10) : null,
      key: `${sourceId}:1:${createHash("sha1").update(it.id).digest("hex").slice(0, 12)}` }));
    return { show, tmdbId: sourceId, sourceId, by: "feed", status: null, name: show.label, episodes };
  }
  let tmdbId = show.meta?.tmdbId || null, by = "stored";
  if (!tmdbId) {
    const found = matchShow(await tmdb.search(show.label || ""), { label: show.label, meta: show.meta, year: valueOf(show.fields?.[ctx.fieldIds.year]) });
    if (!found) return { show, tmdbId: null, by: "none", episodes: [] };
    tmdbId = found.result.id; by = found.by;
  }
  const detail = await tmdb.show(tmdbId);
  // A show already on the board only re-reads from its latest season: new episodes land there or after.
  const from = Math.max(1, ctx.lastSeason?.[String(tmdbId)] || 1);
  const seasons = (detail?.seasons || []).map((s) => s.season_number).filter((n) => n >= from);
  const episodes = [];
  for (const n of seasons) episodes.push(...await tmdb.season(tmdbId, n));
  return { show, tmdbId, sourceId: `tmdb:${tmdbId}`, by, status: detail?.status || null, name: detail?.name || null, episodes };
}

/** Shows to read this run: every show not yet synced, and synced ones still airing. */
export const showsToSync = (shows, { all = false } = {}) =>
  shows.filter((s) => all || !s.meta?.episodesSyncedAt || !FINISHED.has(s.meta?.tmdbStatus));

/** A TMDB client over the provider's calls (utils/providers/tmdb.js), with the key resolved by the caller. */
export async function tmdbClient(key) {
  const { tmdbRaw } = await import("../utils/providers/tmdb.js");
  return {
    search: async (q) => (await tmdbRaw("/search/tv", `query=${encodeURIComponent(q)}&include_adult=false`, key)).results || [],
    show: (id) => tmdbRaw(`/tv/${encodeURIComponent(id)}`, "", key),
    feed: async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`feed ${r.status}`); return r.text(); },
    season: async (id, n) => (await import("../utils/providers/tmdb.js")).seasonEpisodes(id, n, { key }),
  };
}

const running = new Set();

/**
 * Reads the shows in scope and adds their missing episodes. `write(rows, showPatches)` persists — the migration
 * writes Mongo directly; the route also mirrors into the warm cache and tells the tabs. One run per grid at a time
 * (two tabs firing the daily op would otherwise both add the same episodes).
 */
export async function syncTvEpisodes({ gridId, userId, models, tmdb, write, all = false, dryRun = false, log = () => {} }) {
  if (running.has(gridId)) return { skipped: "already running" };
  running.add(gridId);
  try {
    const ctx = await loadEpisodeContext({ gridId, models });
    if (!ctx.moduleId) throw new Error("no Episode module");
    if (ctx.seasonsBoard && !ctx.seasonModuleId) throw new Error("no Season module");
    const todo = showsToSync(ctx.shows, { all });
    const report = { shows: todo.length, added: 0, matched: { stored: 0, poster: 0, year: 0, first: 0, none: 0 }, failed: [], firstMatches: [] };
    for (const show of todo) {
      let got;
      try { got = await fetchShow(show, ctx, tmdb); } catch (e) { report.failed.push(`${show.label}: ${e.message}`); continue; }
      report.matched[got.by] = (report.matched[got.by] || 0) + 1;
      if (got.by === "first" || got.by === "none") report.firstMatches.push(`${show.label} -> ${got.name || "(no match)"}`);
      if (!got.tmdbId) continue;
      // Seasons first, so each new episode can name its season.
      const fresh = got.episodes.filter((e) => e.season > 0 && e.episode > 0 && !ctx.existingKeys.has(e.key || episodeKey(got.tmdbId, e.season, e.episode)));
      const seasons = ctx.seasonsBoard
        ? planSeasons({ show, sourceId: got.sourceId, seasonsNeeded: fresh.map((e) => e.season), seasonRows: ctx.seasonRows, fieldIds: ctx.fieldIds,
          moduleId: ctx.seasonModuleId, containerId: ctx.seasonsBoard.id, userId, gridId })
        : { newRows: [], idOf: () => null };
      const rows = planEpisodeRows({ show, tmdbId: got.tmdbId, episodes: got.episodes, existingKeys: ctx.existingKeys,
        fieldIds: ctx.fieldIds, moduleId: ctx.moduleId, containerId: ctx.container.id, userId, gridId, seasonIdOf: seasons.idOf });
      rows.seasons = seasons.newRows;
      report.added += rows.length;
      report.seasonsAdded = (report.seasonsAdded || 0) + seasons.newRows.length;
      log(`  ${show.label}: ${got.episodes.length} episodes, ${rows.length} new (${got.by})`);
      const meta = got.by === "feed" ? { episodesSyncedAt: new Date().toISOString() } : { tmdbId: got.tmdbId, tmdbStatus: got.status, episodesSyncedAt: new Date().toISOString() };
      if (!dryRun) await write(rows, { id: show.id, meta }, ctx);
    }
    return report;
  } finally { running.delete(gridId); }
}

/** The Mongo half of a write: insert the rows, list them on the board, stamp the show. Returns the docs written. */
export async function writeEpisodesToMongo({ models }, rows, showPatch, ctx) {
  const { Occurrence } = models;
  const now = new Date();
  const docs = rows.map((r) => ({ ...r, timestamp: now, createdAt: now, updatedAt: now }));
  const seasonDocs = (rows.seasons || []).map((r) => ({ ...r, timestamp: now, createdAt: now, updatedAt: now }));
  if (seasonDocs.length) {
    await Occurrence.insertMany(seasonDocs);
    await Occurrence.updateOne({ gridId: ctx.container.gridId, id: ctx.seasonsBoard.id }, { $push: { occurrences: { $each: seasonDocs.map((d) => d.id) } }, $set: { updatedAt: now } });
  }
  if (docs.length) {
    await Occurrence.insertMany(docs);
    await Occurrence.updateOne({ gridId: ctx.container.gridId, id: ctx.container.id }, { $push: { occurrences: { $each: docs.map((d) => d.id) } }, $set: { updatedAt: now } });
    // Each season's Episode List gains its new episodes, in order.
    const bySeason = new Map();
    for (const d of docs) { const sid = d.fields?.[ctx.fieldIds.seasonLink]?.value; if (sid) { if (!bySeason.has(sid)) bySeason.set(sid, []); bySeason.get(sid).push(d.id); } }
    for (const [sid, ids] of bySeason) await Occurrence.updateOne({ gridId: ctx.container.gridId, id: sid }, { $push: { [`fields.${ctx.fieldIds.episodeList}.value`]: { $each: ids } }, $set: { updatedAt: now } });
    docs.touchedSeasons = [...bySeason.keys()];
  }
  docs.seasonDocs = seasonDocs;
  const set = Object.fromEntries(Object.entries(showPatch.meta).map(([k, v]) => [`meta.${k}`, v]));
  await Occurrence.updateOne({ gridId: ctx.container.gridId, id: showPatch.id }, { $set: { ...set, updatedAt: now } });
  return docs;
}
