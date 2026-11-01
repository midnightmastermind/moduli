// services/jellyfinMatch.js — pure planner: which Jellyfin items link to which Moduli rows (media streaming, Task 5).
// No DB, no network. Binding match order: file path -> TMDB/IMDb id -> title + year. A row already carrying the item's
// jellyfinId is `unchanged`. Anything that would link one item to two rows, two items to one row, or re-link a row that
// belongs to another item goes to `ambiguous` with a reason; an item that any row matches is never created.

const SERIES_BOARD = "tv";

const normPath = (p) => String(p || "").replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "").trim();
const wslTail = (p) => { const i = p.indexOf("mnt/wsl/"); return i < 0 ? null : p.slice(i); };
export function pathsMatch(a, b) {
  const x = normPath(a), y = normPath(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = wslTail(x), ty = wslTail(y);
  return !!(tx && ty && tx === ty);
}

export const normTitle = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().replace(/^(the|a|an) /, "").trim();
const yearOf = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
// A missing season/episode number is not 0: Number(null) is 0, which would match a specials row.
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
// Which of several files for one thing wins: the widest picture, then the first by Path, then by Id.
const rank = (a, b) => (Number(b.Width) || 0) - (Number(a.Width) || 0)
  || String(a.Path || "").localeCompare(String(b.Path || "")) || String(a.Id).localeCompare(String(b.Id));
const idStr = (v) => (v == null ? "" : String(v).trim().toLowerCase());

/** Boards an item may link to on an existing row, and the board a create goes to. */
function boardsFor(item) {
  switch (item.Type) {
    case "Movie": return item.library === "documentaries" ? ["documentaries", "danny"] : ["movies", "documentaries"];
    case "Series": return [SERIES_BOARD];
    case "Season": return ["seasons"];
    case "Episode": return ["episodes"];
    default: return [];
  }
}
function createBoard(item) {
  if (item.Type === "Movie") return item.library === "documentaries" ? "danny" : "movies";
  if (item.Type === "Series") return "tv";
  if (item.Type === "Season") return "seasons";
  if (item.Type === "Episode") return "episodes";
  return null;
}

/** Top-level (movie/series) match -> { row } | { none } | { amb: reason }. */
function matchTop(item, rows, items, itemIds = new Set(items.map((i) => i.Id))) {
  const boards = boardsFor(item);
  const cands = rows.filter((r) => boards.includes(r.board));
  const byJf = cands.filter((r) => r.jellyfinId && r.jellyfinId === item.Id);
  if (byJf.length === 1) return { row: byJf[0] };
  const pick = (list, what) => (list.length === 1 ? { row: list[0] } : list.length > 1 ? { amb: `multiple rows match by ${what}` } : null);

  if (item.Path) { const r = pick(cands.filter((c) => pathsMatch(c.filePath, item.Path)), "path"); if (r) return r; }
  const tmdb = idStr(item.ProviderIds?.Tmdb), imdb = idStr(item.ProviderIds?.Imdb);
  if (tmdb || imdb) {
    const r = pick(cands.filter((c) => (tmdb && idStr(c.tmdbId) === tmdb) || (imdb && idStr(c.imdbId) === imdb)), "provider id");
    if (r) return r;
  }
  const t = normTitle(item.Name);
  if (!t) return { none: true };
  const sameTitle = cands.filter((c) => normTitle(c.label) === t);
  // Every row with this title already belongs to ANOTHER item Jellyfin still lists: this is a second file of it.
  if (sameTitle.length && sameTitle.every((c) => c.jellyfinId && c.jellyfinId !== item.Id && itemIds.has(c.jellyfinId))) return { amb: "duplicate file" };
  const iy = yearOf(item.ProductionYear);
  const withYear = sameTitle.filter((c) => { const cy = yearOf(c.year); return cy != null && iy != null && Math.abs(cy - iy) <= 1; });
  if (withYear.length) return pick(withYear, "title and year");
  const noYear = sameTitle.filter((c) => yearOf(c.year) == null || iy == null);
  if (noYear.length) {
    const sameItems = items.filter((i) => i.Type === item.Type && boardsFor(i).join() === boards.join() && normTitle(i.Name) === t);
    if (noYear.length === 1 && sameItems.length === 1 && sameTitle.length === 1) return { row: noYear[0] };
    return { amb: "title matches without a year" };
  }
  return { none: true };
}

/** The keys that make a create a duplicate of another create in the same plan. */
function createKeys(item, board) {
  if (item.Type === "Movie" || item.Type === "Series") {
    const keys = [`${board}|t|${normTitle(item.Name)}|${yearOf(item.ProductionYear) ?? ""}`];
    if (item.Path) keys.push(`${board}|p|${normPath(item.Path)}`);
    return keys;
  }
  const season = item.Type === "Season" ? item.IndexNumber : item.ParentIndexNumber;
  return [`${board}|c|${item.SeriesId}|${num(season)}|${item.Type === "Episode" ? num(item.IndexNumber) : ""}`];
}

export function planJellyfinLinks({ items = [], rows = [] } = {}) {
  const out = { link: [], create: [], ambiguous: [], unchanged: 0 };
  const created = new Set();
  const itemIds = new Set(items.map((i) => i.Id));
  const showRowByJf = new Map(); // series jellyfin id -> row id (linked in this plan or already carrying it)

  // Resolve one batch of items: conflicts are detected within the batch, then emitted.
  // Resolve one batch of items: conflicts are detected within the batch, then emitted. Several unlinked items
  // claiming one row are several FILES of one thing: the best (rank) links, the rest are "duplicate file". A create
  // whose title+year, Path or (series, season, episode) another create in this plan already has is a duplicate too.
  const resolve = (batch, matcher, afterLink) => {
    const results = batch.map((item) => ({ item, m: matcher(item) }));
    const claims = new Map();
    for (const { item, m } of results) {
      if (!m.row || m.row.jellyfinId) continue;
      if (!claims.has(m.row.id)) claims.set(m.row.id, []);
      claims.get(m.row.id).push(item);
    }
    const winner = new Map([...claims].map(([rid, list]) => [rid, [...list].sort(rank)[0].Id]));
    const createOk = new Set();
    for (const { item } of results.filter((x) => x.m.none).sort((a, b) => rank(a.item, b.item))) {
      const board = createBoard(item);
      if (!board) continue;
      const keys = createKeys(item, board);
      if (keys.some((k) => created.has(k))) continue;
      for (const k of keys) created.add(k);
      createOk.add(item.Id);
    }
    for (const { item, m } of results) {
      if (m.amb) { out.ambiguous.push({ jfId: item.Id, reason: m.amb }); continue; }
      if (m.none) {
        const board = createBoard(item);
        if (!board) continue;
        if (createOk.has(item.Id)) out.create.push({ item, board });
        else out.ambiguous.push({ jfId: item.Id, reason: "duplicate file" });
        continue;
      }
      const r = m.row;
      if (r.jellyfinId === item.Id) { out.unchanged++; afterLink?.(item, r); continue; }
      // The row belongs to another item Jellyfin still lists: a second file of the same thing.
      if (r.jellyfinId) { out.ambiguous.push({ jfId: item.Id, reason: itemIds.has(r.jellyfinId) ? "duplicate file" : "row linked to another item" }); continue; }
      if (winner.get(r.id) !== item.Id) { out.ambiguous.push({ jfId: item.Id, reason: "duplicate file" }); continue; }
      out.link.push({ occId: r.id, jfId: item.Id });
      afterLink?.(item, r);
    }
  };

  const top = items.filter((i) => i.Type === "Movie" || i.Type === "Series");
  resolve(top, (i) => matchTop(i, rows, items, itemIds), (i, r) => { if (i.Type === "Series") showRowByJf.set(i.Id, r.id); });
  for (const r of rows) if (r.board === SERIES_BOARD && r.jellyfinId && !showRowByJf.has(r.jellyfinId)) showRowByJf.set(r.jellyfinId, r.id);

  const child = (kind) => (item) => {
    const showRow = showRowByJf.get(item.SeriesId);
    if (!showRow) return { amb: "series unlinked" };
    const season = num(kind === "Season" ? item.IndexNumber : item.ParentIndexNumber);
    const index = num(item.IndexNumber);
    const board = kind === "Season" ? "seasons" : "episodes";
    const byJf = rows.find((r) => r.board === board && r.jellyfinId === item.Id);
    if (byJf) return { row: byJf };
    if (season == null || (kind === "Episode" && index == null)) return { none: true };
    const hits = rows.filter((r) => r.board === board && r.showRowId === showRow && num(r.season) === season
      && (kind === "Season" || num(r.number) === index));
    if (hits.length === 1) return { row: hits[0] };
    return hits.length ? { amb: "multiple rows match by season/episode" } : { none: true };
  };
  resolve(items.filter((i) => i.Type === "Season"), child("Season"));
  resolve(items.filter((i) => i.Type === "Episode"), child("Episode"));
  return out;
}
