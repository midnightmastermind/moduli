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
function matchTop(item, rows, items) {
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

export function planJellyfinLinks({ items = [], rows = [] } = {}) {
  const out = { link: [], create: [], ambiguous: [], unchanged: 0 };
  const showRowByJf = new Map(); // series jellyfin id -> row id (linked in this plan or already carrying it)

  // Resolve one batch of items: conflicts are detected within the batch, then emitted.
  const resolve = (batch, matcher, afterLink) => {
    const results = batch.map((item) => ({ item, m: matcher(item) }));
    const claims = new Map();
    for (const { item, m } of results) {
      if (!m.row || m.row.jellyfinId) continue;
      if (!claims.has(m.row.id)) claims.set(m.row.id, []);
      claims.get(m.row.id).push(item);
    }
    for (const { item, m } of results) {
      if (m.amb) { out.ambiguous.push({ jfId: item.Id, reason: m.amb }); continue; }
      if (m.none) { const board = createBoard(item); if (board) out.create.push({ item, board }); continue; }
      const r = m.row;
      if (r.jellyfinId === item.Id) { out.unchanged++; afterLink?.(item, r); continue; }
      if (r.jellyfinId) { out.ambiguous.push({ jfId: item.Id, reason: "row linked to another item" }); continue; }
      if (claims.get(r.id).length > 1) { out.ambiguous.push({ jfId: item.Id, reason: "several items match one row" }); continue; }
      out.link.push({ occId: r.id, jfId: item.Id });
      afterLink?.(item, r);
    }
  };

  const top = items.filter((i) => i.Type === "Movie" || i.Type === "Series");
  resolve(top, (i) => matchTop(i, rows, items), (i, r) => { if (i.Type === "Series") showRowByJf.set(i.Id, r.id); });
  for (const r of rows) if (r.board === SERIES_BOARD && r.jellyfinId && !showRowByJf.has(r.jellyfinId)) showRowByJf.set(r.jellyfinId, r.id);

  const child = (kind) => (item) => {
    const showRow = showRowByJf.get(item.SeriesId);
    if (!showRow) return { amb: "series unlinked" };
    const season = kind === "Season" ? item.IndexNumber : item.ParentIndexNumber;
    const board = kind === "Season" ? "seasons" : "episodes";
    const byJf = rows.find((r) => r.board === board && r.jellyfinId === item.Id);
    if (byJf) return { row: byJf };
    const hits = rows.filter((r) => r.board === board && r.showRowId === showRow && Number(r.season) === Number(season)
      && (kind === "Season" || Number(r.number) === Number(item.IndexNumber)));
    if (hits.length === 1) return { row: hits[0] };
    return hits.length ? { amb: "multiple rows match by season/episode" } : { none: true };
  };
  resolve(items.filter((i) => i.Type === "Season"), child("Season"));
  resolve(items.filter((i) => i.Type === "Episode"), child("Episode"));
  return out;
}
