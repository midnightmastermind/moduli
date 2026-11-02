// services/jellyfinSync.js — every Jellyfin movie, show, season, episode and documentary on its Moduli board, and
// what the owner has played in Jellyfin shown as Last Watched (media streaming, Task 6).
//
// Shape after services/tvEpisodes.js: loadContext reads the boards, fields and rows off the grid; planPass is pure
// (planJellyfinLinks decides link / create / ambiguous, this file turns that into documents); `write(changes, ctx)`
// persists — writeJellyfinToMongo is the Mongo half, the route also mirrors into the warm cache and tells the tabs.
//
// TWO PASSES PER RUN. Pass 1 links and creates (new Series rows included); then the rows are re-read and planned
// again, so a show created in pass 1 links/creates its seasons and episodes in the same run. A second full run plans
// nothing. A dry run plans pass 2 over pass 1's changes applied in memory.
//
// WATCH STATE. Only the owner's own Jellyfin user (`cfg.userId`) is ever read. When an item is Played and its
// LastPlayedDate is newer than the row's Watched At (else its Last Watched day), both are set: Last Watched = the day
// you finished in YOUR zone (`user.meta.share.timeZone`, the zone the share/feeds code already uses, else
// America/Chicago), Watched At = the exact ISO instant. Never moved backward.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { planJellyfinLinks } from "./jellyfinMatch.js";
import { seasonKey, episodeKey, seasonLabel, episodeLabel } from "./tvEpisodes.js";

export const DANNY_SIGNATURE = "jellyfin:danny";
const TAG_BOARD = { movie: "movies", documentary: "danny", series: "tv", season: "seasons", episode: "episodes" };
const BOARD_TAG = Object.fromEntries(Object.entries(TAG_BOARD).map(([t, b]) => [b, t]));
const FIELD_NAMES = {
  category: ["Board Category", "select"], year: ["Year", "number"], filePath: ["File Path", "text"], owned: ["Owned", "boolean"],
  show: ["TV Show", "occurrence"], season: ["Season", "number"], number: ["Episode #", "number"], airDate: ["Air Date", "date"],
  seasonLink: ["TV Season", "occurrence"], episodeList: ["Episode List", "occurrence"],
  lastWatched: ["Last Watched", "date"], watchedAt: ["Watched At", "text"],
};

const valueOf = (cell) => (cell && typeof cell === "object" && !Array.isArray(cell) && "value" in cell ? cell.value : cell);
const cellOf = (value) => ({ value, flow: "in" });
const numId = (v) => { const s = String(v ?? "").trim(); return !s ? null : /^\d+$/.test(s) ? Number(s) : s; };
const toDay = (v) => (v == null || v === "" ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const msOf = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };

export const DEFAULT_TIME_ZONE = "America/Chicago";

/** The calendar day (YYYY-MM-DD) an instant falls on in `timeZone`. */
export function localDay(iso, timeZone = DEFAULT_TIME_ZONE) {
  const d = new Date(iso);
  let tz = timeZone || DEFAULT_TIME_ZONE;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); } catch { tz = DEFAULT_TIME_ZONE; }
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// A Jellyfin play this soon after the row's Watched At is the same viewing: Moduli's player writes Watched At at 90%
// and then POSTs /played, so Jellyfin's LastPlayedDate lands seconds later. Treating it as newer rewrote Watched At
// and gave Media: Log Watch a second key, so a second Watch entry (prod, 2026-11-02).
export const SAME_VIEWING_MS = 2 * 3600 * 1000;

/** Is a Jellyfin play at `iso` a newer viewing than the row records? Watched At first, else Last Watched's day. */
export function isNewerWatch(row, iso, timeZone = DEFAULT_TIME_ZONE) {
  const t = msOf(iso);
  if (t == null) return false;
  if (row.watchedAt) { const w = msOf(row.watchedAt); if (w != null) return t > w + SAME_VIEWING_MS; }
  if (row.lastWatched) return localDay(iso, timeZone) > toDay(row.lastWatched);
  return true;
}

/** One item per Jellyfin Id: the first view's copy wins; `dropped` names each later copy's library. */
export function dedupeItems(items) {
  const seen = new Map(), out = [], dropped = [];
  for (const it of items || []) {
    const kept = seen.get(it.Id);
    if (kept) { dropped.push({ Id: it.Id, kept: kept.library, dropped: it.library }); continue; }
    seen.set(it.Id, it); out.push(it);
  }
  return { items: out, dropped };
}

// ── context ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function loadContext({ gridId, models }) {
  const { Field, Occurrence } = models;
  const fields = await Field.find({ gridId, trashed: { $ne: true } }).lean();
  const fieldIds = {};
  for (const [k, [name, type]] of Object.entries(FIELD_NAMES)) fieldIds[k] = fields.find((f) => f.name === name && f.type === type && !f.displayEnabled)?.id || null;
  for (const k of ["category", "lastWatched", "watchedAt"]) if (!fieldIds[k]) throw new Error(`no "${FIELD_NAMES[k][0]}" field (run migration 0479)`);

  const feeds = await Occurrence.find({ gridId, "feed.enabled": true }).lean();
  const byTag = (tag) => feeds.find((o) => !o.meta?.feedSourceId && (o.feed?.conditions || []).some((c) => c.fieldId === fieldIds.category && c.value === tag && c.comparator === "CONTAINS"));
  const boards = {
    movies: byTag("movie") || null,
    tv: byTag("series") || null,
    seasons: await Occurrence.findOne({ gridId, identitySignature: "tv:seasons" }).lean(),
    episodes: await Occurrence.findOne({ gridId, identitySignature: "tv:episodes" }).lean(),
    danny: await Occurrence.findOne({ gridId, identitySignature: DANNY_SIGNATURE }).lean(),
  };

  const raw = new Map();
  const rows = await Occurrence.find({ gridId, [`fields.${fieldIds.category}.value`]: { $in: Object.keys(TAG_BOARD) },
    "meta.feedSourceId": { $exists: false }, "feed.enabled": { $ne: true } }).lean();
  for (const r of rows) raw.set(r.id, r);
  const ctx = { gridId, fieldIds, boards, raw };
  // The board's shared module: the one most of its rows use, else the module the board names.
  const counts = {};
  for (const r of rows) { const b = boardOf(ctx, r); if (!b) continue; (counts[b] ||= {}); counts[b][r.moduleId] = (counts[b][r.moduleId] || 0) + 1; }
  const top = (b) => Object.entries(counts[b] || {}).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  ctx.moduleIds = {
    movies: top("movies"), tv: top("tv"),
    seasons: top("seasons") || boards.seasons?.meta?.seasonModuleId || null,
    episodes: top("episodes") || boards.episodes?.meta?.episodeModuleId || null,
    danny: boards.danny?.meta?.documentaryModuleId || top("danny"),
  };
  return ctx;
}

function boardOf(ctx, o) {
  const tags = valueOf(o.fields?.[ctx.fieldIds.category]);
  const list = Array.isArray(tags) ? tags : tags ? [tags] : [];
  for (const t of list) if (TAG_BOARD[t]) return TAG_BOARD[t];
  return null;
}

function planRows(ctx) {
  const f = ctx.fieldIds, out = [];
  const boardIds = new Set(Object.values(ctx.boards).filter(Boolean).map((b) => b.id));
  for (const o of ctx.raw.values()) {
    if (boardIds.has(o.id)) continue;
    const board = boardOf(ctx, o);
    if (!board) continue;
    out.push({
      id: o.id, board, label: o.label || "", year: valueOf(o.fields?.[f.year]) ?? null, filePath: valueOf(o.fields?.[f.filePath]) || "",
      tmdbId: o.meta?.tmdbId ?? "", imdbId: o.meta?.imdbId || "", jellyfinId: o.meta?.jellyfinId || "",
      showRowId: f.show ? valueOf(o.fields?.[f.show]) || null : null, season: valueOf(o.fields?.[f.season]) ?? null,
      number: valueOf(o.fields?.[f.number]) ?? null,
      lastWatched: valueOf(o.fields?.[f.lastWatched]) || null, watchedAt: valueOf(o.fields?.[f.watchedAt]) || null,
    });
  }
  return out;
}

// ── planning ────────────────────────────────────────────────────────────────────────────────────────────────────────

const PLAYABLE = new Set(["Movie", "Episode"]);
const emptyChanges = () => ({ creates: [], updates: [], pushes: [] });
export const changeCount = (c) => c.creates.length + c.updates.length + c.pushes.length;

/** One pass: the planner's answer as documents. Pure. -> { changes, summary }. */
export function planPass(ctx, items, { userId, gridId, newId = randomUUID } = {}) {
  const f = ctx.fieldIds;
  const rows = planRows(ctx);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const plan = planJellyfinLinks({ items, rows });
  const itemById = new Map(items.map((i) => [i.Id, i]));
  const changes = emptyChanges();
  const summary = { link: plan.link.length, create: {}, unchanged: plan.unchanged, skipped: [],
    ambiguous: plan.ambiguous.map((a) => ({ ...a, name: itemById.get(a.jfId)?.Name || "" })) };

  // Series jellyfin id -> show row (already linked, or linked in this plan).
  const showByJf = new Map();
  for (const r of rows) if (r.board === "tv" && r.jellyfinId) showByJf.set(r.jellyfinId, r);
  for (const l of plan.link) {
    const item = itemById.get(l.jfId), row = rowById.get(l.occId);
    const set = { "meta.jellyfinId": item.Id };
    if (PLAYABLE.has(item.Type)) set["meta.jellyfinPlayable"] = true;
    const tmdb = numId(item.ProviderIds?.Tmdb);
    if (tmdb != null && !row.tmdbId && (item.Type === "Movie" || item.Type === "Series")) set["meta.tmdbId"] = tmdb;
    changes.updates.push({ id: row.id, set });
    if (item.Type === "Series") showByJf.set(item.Id, { ...row, tmdbId: row.tmdbId || tmdb || "" });
  }

  // (show row, season number) -> season row id — existing rows first, then the ones created below.
  const seasonRowFor = new Map();
  for (const r of rows) if (r.board === "seasons" && r.showRowId) seasonRowFor.set(`${r.showRowId}:${Number(r.season)}`, r.id);
  const episodeKeys = new Set([...ctx.raw.values()].map((o) => o.meta?.episodeKey).filter(Boolean));
  const listPush = new Map();
  const pushTo = (id, p, x) => { const k = `${id}|${p}`; if (!listPush.has(k)) listPush.set(k, { id, path: p, ids: [] }); listPush.get(k).ids.push(x); };

  const order = { Movie: 0, Series: 0, Season: 1, Episode: 2 };
  const creates = [...plan.create].sort((a, b) => order[a.item.Type] - order[b.item.Type]);
  for (const { item, board } of creates) {
    const container = ctx.boards[board], moduleId = ctx.moduleIds[board];
    if (!container || !moduleId) { summary.skipped.push({ jfId: item.Id, name: item.Name, reason: `no ${board} board or module` }); continue; }
    const id = newId();
    const fields = { [f.category]: cellOf([BOARD_TAG[board]]) };
    const meta = { jellyfinId: item.Id };
    if (PLAYABLE.has(item.Type)) meta.jellyfinPlayable = true;
    let label = item.Name || "";
    if (item.Type === "Movie" || item.Type === "Series") {
      if (item.ProductionYear && f.year) fields[f.year] = cellOf(item.ProductionYear);
      if (item.Path && f.filePath) fields[f.filePath] = cellOf(item.Path);
      if (f.owned) fields[f.owned] = cellOf(true);
      const tmdb = numId(item.ProviderIds?.Tmdb);
      if (tmdb != null) meta.tmdbId = tmdb;
      if (item.ProviderIds?.Imdb) meta.imdbId = item.ProviderIds.Imdb;
    } else {
      const show = showByJf.get(item.SeriesId);
      const s = item.Type === "Season" ? item.IndexNumber : item.ParentIndexNumber;
      if (!show || s == null || (item.Type === "Episode" && item.IndexNumber == null) || !f.show || !f.season) {
        summary.skipped.push({ jfId: item.Id, name: item.Name, reason: "no show row or no season/episode number" }); continue;
      }
      const source = show.tmdbId ? `tmdb:${show.tmdbId}` : `jf:${item.SeriesId}`;
      fields[f.show] = cellOf(show.id);
      fields[f.season] = cellOf(Number(s));
      if (item.Type === "Season") {
        label = seasonLabel(show.label, s);
        if (f.episodeList) fields[f.episodeList] = cellOf([]);
        meta.seasonKey = seasonKey(source, s);
        seasonRowFor.set(`${show.id}:${Number(s)}`, id);
      } else {
        const key = show.tmdbId ? episodeKey(show.tmdbId, s, item.IndexNumber) : `jf:${item.Id}`;
        if (episodeKeys.has(key)) { summary.skipped.push({ jfId: item.Id, name: item.Name, reason: `episode key ${key} already on the board` }); continue; }
        episodeKeys.add(key);
        label = episodeLabel({ season: s, episode: item.IndexNumber, title: item.Name });
        if (f.number) fields[f.number] = cellOf(Number(item.IndexNumber));
        if (item.PremiereDate && f.airDate) fields[f.airDate] = cellOf(String(item.PremiereDate).slice(0, 10));
        meta.episodeKey = key;
        const sid = seasonRowFor.get(`${show.id}:${Number(s)}`);
        if (sid && f.seasonLink) { fields[f.seasonLink] = cellOf(sid); if (f.episodeList) pushTo(sid, `fields.${f.episodeList}.value`, id); }
      }
    }
    const doc = { id, userId, gridId, moduleId, parentId: container.id, label, fields, occurrences: [], meta };
    if (item.ImageTags?.Primary) doc._coverItemId = item.Id;
    changes.creates.push(doc);
    pushTo(container.id, "occurrences", id);
    summary.create[board] = (summary.create[board] || 0) + 1;
    if (item.Type === "Series") showByJf.set(item.Id, { id, board, label, tmdbId: meta.tmdbId || "" });
  }
  changes.pushes = [...listPush.values()];
  return { changes, summary };
}

/** Watch-state updates over rows that carry a jellyfinId. Pure. */
export function planWatch(ctx, items, timeZone = DEFAULT_TIME_ZONE) {
  const f = ctx.fieldIds, changes = emptyChanges();
  const byJf = new Map();
  for (const r of planRows(ctx)) if (r.jellyfinId) byJf.set(r.jellyfinId, r);
  for (const item of items) {
    const ud = item.UserData;
    if (!ud?.Played || !ud.LastPlayedDate) continue;
    // Jellyfin keeps Played=true and moves LastPlayedDate the moment a REWATCH starts in its own UI; a finish resets
    // the resume position to 0. A play with a position left is a viewing in progress, not a finished one.
    if (Number(ud.PlaybackPositionTicks) > 0) continue;
    const row = byJf.get(item.Id);
    if (!row) continue;
    const t = msOf(ud.LastPlayedDate);
    if (t == null) continue;
    const iso = new Date(t).toISOString();
    if (!isNewerWatch(row, iso, timeZone)) continue;
    changes.updates.push({ id: row.id, set: { [`fields.${f.lastWatched}`]: cellOf(localDay(iso, timeZone)), [`fields.${f.watchedAt}`]: cellOf(iso) } });
  }
  return changes;
}

/** A linked row parented to a board the board does not list (a write that stopped after its insert): list it. Pure. */
export function planRelist(ctx) {
  const changes = emptyChanges();
  const boards = Object.values(ctx.boards).filter(Boolean);
  const byId = new Map(boards.map((b) => [b.id, b]));
  const add = new Map();
  for (const o of ctx.raw.values()) {
    if (!o.meta?.jellyfinId || !byId.has(o.parentId)) continue;
    if ((byId.get(o.parentId).occurrences || []).includes(o.id)) continue;
    if (!add.has(o.parentId)) add.set(o.parentId, []);
    add.get(o.parentId).push(o.id);
  }
  changes.pushes = [...add].map(([id, ids]) => ({ id, path: "occurrences", ids }));
  return changes;
}

// ── applying ────────────────────────────────────────────────────────────────────────────────────────────────────────

const setPath = (o, p, v) => { const ks = p.split("."); let cur = o; for (const k of ks.slice(0, -1)) cur = (cur[k] && typeof cur[k] === "object") ? cur[k] : (cur[k] = {}); cur[ks.at(-1)] = v; };
const getPath = (o, p) => p.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);

/** Applies changes to a Map(id -> occurrence doc), the way writeJellyfinToMongo applies them to Mongo. */
export function applyChanges(store, changes) {
  for (const d of changes.creates) { const { _coverItemId, ...doc } = d; store.set(doc.id, structuredClone(doc)); }
  for (const u of changes.updates) { const o = store.get(u.id); if (o) for (const [p, v] of Object.entries(u.set)) setPath(o, p, structuredClone(v)); }
  for (const p of changes.pushes) {
    const o = store.get(p.id); if (!o) continue;
    const cur = getPath(o, p.path);
    setPath(o, p.path, [...(Array.isArray(cur) ? cur : []), ...p.ids]);
  }
}

/** The Mongo half of a write. Returns { created: docs, touched: [ids] }. */
export async function writeJellyfinToMongo({ models }, changes, ctx) {
  const { Occurrence } = models;
  const now = new Date(), gridId = ctx.gridId;
  const created = changes.creates.map(({ _coverItemId, ...d }) => ({ ...d, timestamp: now, createdAt: now, updatedAt: now }));
  if (created.length) await Occurrence.insertMany(created);
  const touched = new Set();
  for (const u of changes.updates) { await Occurrence.updateOne({ gridId, id: u.id }, { $set: { ...u.set, updatedAt: now } }); touched.add(u.id); }
  for (const p of changes.pushes) { await Occurrence.updateOne({ gridId, id: p.id }, { $push: { [p.path]: { $each: p.ids } }, $set: { updatedAt: now } }); touched.add(p.id); }
  for (const d of created) touched.delete(d.id);
  return { created, touched: [...touched] };
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const running = new Set();

// The op runs on every load (and at 05:00); a full pass over every library is not worth repeating that often.
// lastCompleted is stamped only by a SUCCESSFUL, non-dry run (and persisted on grid.meta.jellyfinLastSyncAt so a
// restart does not forget it). `force` and dry runs bypass the skip — that decision is the caller's.
export const SYNC_MIN_INTERVAL_MS = 15 * 60e3;
const lastCompleted = new Map();
export const _resetSyncStamps = () => lastCompleted.clear();
export function markSyncCompleted(gridId, at = Date.now()) { lastCompleted.set(String(gridId), at); }
/** { skipped: "recent", lastAt } when a run completed under 15 minutes ago (memory or `persistedAt`), else null. */
export function recentSync(gridId, persistedAt, now = Date.now()) {
  const p = persistedAt ? Date.parse(persistedAt) : NaN;
  const last = Math.max(lastCompleted.get(String(gridId)) ?? -Infinity, Number.isFinite(p) ? p : -Infinity);
  if (!Number.isFinite(last) || now - last >= SYNC_MIN_INTERVAL_MS) return null;
  return { skipped: "recent", lastAt: new Date(last).toISOString() };
}

/**
 * `jf` = { items: () => Jellyfin items (each with `library`), cover: (itemId) => stored cover URL | null }.
 * `write(changes, ctx)` persists one pass. One run per grid at a time.
 */
export async function syncJellyfin({ gridId, userId, models, jf, write, dryRun = false, log = () => {}, newId = randomUUID, timeZone = DEFAULT_TIME_ZONE }) {
  if (running.has(gridId)) return { skipped: "already running" };
  running.add(gridId);
  try {
    const deduped = dedupeItems(await jf.items());
    const items = deduped.items;
    let ctx = await loadContext({ gridId, models });
    // Pass 2 / the watch step read the boards' lists from memory in a dry run; keep them in step with the pushes.
    const applyAll = (changes) => {
      applyChanges(ctx.raw, changes);
      const boards = new Map(Object.values(ctx.boards).filter(Boolean).map((b) => [b.id, b]));
      applyChanges(boards, { creates: [], updates: [], pushes: changes.pushes.filter((p) => boards.has(p.id)) });
    };
    const report = { items: items.length, duplicateIds: deduped.dropped.length, link: 0, create: {}, unchanged: 0, ambiguous: [], skipped: [], watch: 0, relisted: 0, dryRun };
    for (const pass of [1, 2]) {
      const { changes, summary } = planPass(ctx, items, { userId, gridId, newId });
      report.link += summary.link;
      for (const [b, c] of Object.entries(summary.create)) report.create[b] = (report.create[b] || 0) + c;
      if (pass === 1) report.unchanged = summary.unchanged;
      report.ambiguous = summary.ambiguous;            // pass 2's: what is still ambiguous after the new shows exist
      report.skipped.push(...summary.skipped);
      log(`  pass ${pass}: link ${summary.link}, create ${JSON.stringify(summary.create)}, ambiguous ${summary.ambiguous.length}`);
      if (!changeCount(changes)) continue;
      if (!dryRun) {
        for (const d of changes.creates) {
          if (!d._coverItemId) continue;
          const url = await jf.cover(d._coverItemId).catch(() => null);
          if (url) d.meta.cover = url;
        }
        await write(changes, ctx);
      }
      if (pass === 1 && !dryRun) ctx = await loadContext({ gridId, models });
      else applyAll(changes);
    }
    const relist = planRelist(ctx);
    report.relisted = relist.pushes.reduce((n, p) => n + p.ids.length, 0);
    if (report.relisted) { if (!dryRun) await write(relist, ctx); applyAll(relist); }
    const watch = planWatch(ctx, items, timeZone);
    report.watch = watch.updates.length;
    if (watch.updates.length && !dryRun) await write(watch, ctx);
    return report;
  } finally { running.delete(gridId); }
}

// ── Jellyfin client ─────────────────────────────────────────────────────────────────────────────────────────────────

const SKIP_COLLECTIONS = new Set(["music", "books", "playlists", "boxsets", "livetv", "musicvideos", "photos"]);
const PAGE = 500;

/** Every Movie/Series/Season/Episode in the owner's video libraries, each tagged with its `library`. */
export async function fetchJellyfinItems(cfg, fetcher) {
  const uid = encodeURIComponent(cfg.userId || "");
  if (!cfg.userId) throw new Error("no Jellyfin user configured");
  const getJson = async (p) => {
    const r = await fetcher(cfg, p);
    if (!r.ok) throw Object.assign(new Error(`Jellyfin ${r.status} for ${p.split("?")[0]}`), { status: r.status });
    return r.json();
  };
  let views;
  try { views = await getJson(`/UserViews?userId=${uid}`); } catch (e) { if (e.status !== 404) throw e; views = await getJson(`/Users/${uid}/Views`); }
  const out = [];
  for (const v of views.Items || []) {
    const ct = String(v.CollectionType || "").toLowerCase();
    if (SKIP_COLLECTIONS.has(ct)) continue;
    const library = /documentar/i.test(v.Name || "") ? "documentaries" : ct === "tvshows" ? "shows" : "movies";
    for (let start = 0; ; start += PAGE) {
      const q = `userId=${uid}&ParentId=${encodeURIComponent(v.Id)}&Recursive=true&IncludeItemTypes=Movie,Series,Season,Episode,Video`
        + `&Fields=Path,ProviderIds,PremiereDate,ProductionYear&EnableUserData=true&SortBy=SortName&StartIndex=${start}&Limit=${PAGE}`;
      const page = await getJson(`/Items?${q}`);
      for (const it of page.Items || []) {
        // A "home videos" library (Documentaries) holds Video items: those are its films. A Video anywhere else
        // (a trailer, an extra) is not a row.
        if (it.Type === "Video") { if (library === "documentaries") out.push({ ...it, Type: "Movie", jellyfinType: "Video", library }); continue; }
        out.push({ ...it, library });
      }
      if ((page.Items || []).length < PAGE) break;
    }
  }
  const { items, dropped } = dedupeItems(out);
  items.dropped = dropped;
  return items;
}

const UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Copies an item's Primary image into uploads/ and returns its URL (no Jellyfin key in it), or null. */
export async function storeJellyfinCover(cfg, itemId, fetcher, { uploadsDir = UPLOADS_DIR } = {}) {
  const r = await fetcher(cfg, `/Items/${encodeURIComponent(itemId)}/Images/Primary?maxWidth=500&quality=85`);
  if (!r.ok) return null;
  const ext = EXT[String(r.headers.get("content-type") || "").split(";")[0].trim()] || "jpg";
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) return null;
  const now = new Date();
  const shard = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const name = `jf-${createHash("sha256").update(buf).digest("hex").slice(0, 16)}.${ext}`;
  const dir = path.join(uploadsDir, "user", shard);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return `/uploads/user/${shard}/${name}`;
}

/** The `jf` a real run uses. */
export async function jellyfinClient(cfg) {
  const { jellyfinFetch } = await import("./jellyfinConfig.js");
  return { items: () => fetchJellyfinItems(cfg, jellyfinFetch), cover: (id) => storeJellyfinCover(cfg, id, jellyfinFetch) };
}
