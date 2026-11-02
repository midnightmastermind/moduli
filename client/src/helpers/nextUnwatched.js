// helpers/nextUnwatched.js — "Play next unwatched" on a TV Series / Season row (media streaming plan, Task 9).
//
// PURE. The episodes are the rows that NAME the show or season (an episode's TV Show / TV Season link, written by
// the Jellyfin + TMDB syncs); the next one is the first by (season, number) that has a file in Jellyfin
// (`meta.jellyfinId`) and has not been watched (Last Watched or Watched At). An unwatched episode with no file that
// comes before it is skipped and REPORTED, so the caller can say so instead of silently jumping a gap.

const valueOf = (cell) => (cell && typeof cell === "object" && !Array.isArray(cell) && "value" in cell ? cell.value : cell);
const names = (v, id) => (Array.isArray(v) ? v.map(String).includes(id) : v != null && String(v) === id);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : Infinity; };

/** A row the Jellyfin sync linked that is not itself playable — a Series or a Season (the sync flags Movie/Episode). */
export function isShowOrSeasonRow(occ) {
  return !!occ?.meta?.jellyfinId && occ.meta.jellyfinPlayable !== true;
}

/**
 * The episodes of a show or season row, from `occurrences` (any iterable of occurrences).
 * `fieldIds` = { show, seasonLink, season, number, lastWatched, watchedAt }. Feed copies are left out.
 */
export function episodesForRow(row, occurrences, fieldIds) {
  const id = String(row?.id ?? "");
  if (!id) return [];
  const f = fieldIds || {};
  const out = [];
  for (const o of occurrences || []) {
    if (!o || o.id === id || o.meta?.feedSourceId) continue;
    const fields = o.fields || {};
    const linked = (f.seasonLink && names(valueOf(fields[f.seasonLink]), id)) || (f.show && names(valueOf(fields[f.show]), id));
    if (!linked) continue;
    out.push({
      id: o.id, label: o.label || "", occurrence: o,
      season: valueOf(fields[f.season]), number: valueOf(fields[f.number]),
      jellyfinId: o.meta?.jellyfinId || "",
      watched: !!(valueOf(fields[f.lastWatched]) || valueOf(fields[f.watchedAt])),
    });
  }
  return out.sort((a, b) => num(a.season) - num(b.season) || num(a.number) - num(b.number));
}

/** -> { episode, skipped: [labels] } | null (everything watched, or nothing left with a file). */
export function nextUnwatched({ showOrSeasonRow, episodes } = {}) {
  if (!showOrSeasonRow) return null;
  const ordered = [...(episodes || [])].sort((a, b) => num(a.season) - num(b.season) || num(a.number) - num(b.number));
  const skipped = [];
  for (const e of ordered) {
    if (e.watched) continue;
    if (!e.jellyfinId) { skipped.push(e.label || `S${e.season}E${e.number}`); continue; }
    return { episode: e, skipped };
  }
  return null;
}
