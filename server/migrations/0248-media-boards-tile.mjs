/**
 * 0248 — the media boards become a wrapping grid of poster tiles.
 *
 * User, 2026-08-25: *"could you also make the media tiles have a max width and
 * layout row with wrap"*
 *
 * ── WHICH BOARDS IS A MEASUREMENT, NOT THE WORD "MEDIA" ──────────────────
 *
 * 2026-08-25 already settled the rule while tiling Readings and Courses: *"a
 * tile with no picture is a taller row"*. It refused Songs, Albums, Artists and
 * Books on exactly that ground — the Spotify and Calibre imports carry no cover
 * art, so tiling them would be ten thousand empty boxes.
 *
 * `0245`/`0246` CHANGED THAT FACT for two boards, which is the whole reason
 * this is now possible. Re-measured on poms grid, counting a picture through
 * every route that can draw one (occurrence `meta.cover`, the module's own
 * `fileRef`, an artifact CHILD carrying one, and a media-role field value):
 *
 * ```
 * Movies      993 rows   989 with a picture  100%   <- tile
 * TV Series   187 rows   183                  98%   <- tile
 * Games         4 rows     0                   0%   <- NO
 * Comics        5 rows     0                   0%   <- NO
 * Songs      5489 rows     5                   0%   <- NO
 * Albums     3027 rows     0                   0%   <- NO
 * Artists    1679 rows     0                   0%   <- NO
 * Books       877 rows     0                   0%   <- NO
 * ```
 *
 * **Games and Comics are the discriminating case, and they are refused.** They
 * are media boards by every other measure — same import, same `0238` mint,
 * sitting beside Movies in the same folder — and TMDB is a film/TV database, so
 * neither got a poster. Selecting on the word "media" would have tiled 9 rows
 * into empty boxes; selecting on PICTURES does not.
 *
 * ── THE SELECTOR IS STRUCTURAL ───────────────────────────────────────────
 *
 * A board qualifies when its rows are `role:"artifact"` of a MEDIA KIND (the
 * kinds `0238` minted) and at least 80% of them carry a picture. Nothing keys
 * on a label, so renaming "Movies" cannot break it, and a board that gains
 * cover art later qualifies on the next run rather than needing a new list.
 *
 * ── REPORTED, NOT DONE: Bookmarks ────────────────────────────────────────
 *
 * All 1,467 bookmarks carry a `meta.cover` on their MODULE (2026-08-23), so by
 * coverage alone that board qualifies too. It is deliberately NOT tiled: it is
 * not one of the media-import kinds, the user's ask was about the media tiles,
 * and 2026-08-23 measured those covers as mostly FAVICONS — "a wall of
 * favicons" reads very differently at tile size than a poster does. Reshaping a
 * 1,467-row board nobody mentioned is the user's call, not a migration's.
 *
 * ── THE NUMBERS, AND WHY THEY ARE DATA ───────────────────────────────────
 *
 * `mode` / `childMinWidth` / `childMaxWidth` / `childMaxHeight` / `childGap`
 * are all existing layout-cascade keys the Layout menu already edits, written
 * to `meta.layoutCascadeOverride` — the same slot `0237` used. So every number
 * here is a starting point the user can change in the UI, not a constant baked
 * into a renderer.
 *
 * A poster is 2:3, so a 150px tile draws ~225px of picture; 320px of height
 * leaves room for the title and the field strip under it, and a tile that needs
 * more scrolls its FIELD BLOCK rather than growing (the wrap CSS already does
 * that). `childMaxWidth` matters because until this pass it was INERT on a
 * container — read only by `PageBoard` — which is why the client half ships
 * alongside.
 *
 * MERGES rather than replaces: a board that already carries other cascade keys
 * keeps them, and a re-run is a no-op.
 */

export const id = "0248-media-boards-tile";
export const describe =
  "Lays the media boards out as a wrapping grid of poster tiles with a capped width. Selects boards STRUCTURALLY by media kind + measured picture coverage (>=80%), so Games and Comics — which have no posters — are refused.";
export const touches = ["occurrences"];

/** The kinds `0238` minted for the media import. */
export const MEDIA_KINDS = Object.freeze(["movie", "series", "game", "comic"]);

/** A board must be at least this covered before tiling helps rather than hurts. */
export const COVERAGE_THRESHOLD = 0.8;
export const MIN_ROWS = 4;

/** The tile shape. Every key is one the Layout menu already edits. */
export const TILE_LAYOUT = Object.freeze({
  mode: "wrap",
  childContentDirection: "column",
  childMinWidth: 150,
  childMaxWidth: 150,
  childMaxHeight: 320,
  childGap: 10,
});

/** Does anything on this row resolve to a picture? All four routes. */
export function rowHasPicture(occ, { modById, childrenOf, mediaFieldIds }) {
  if (occ?.meta?.cover) return true;
  const mod = modById.get(occ?.moduleId);
  if (mod?.meta?.cover) return true;
  if (mod?.fileRef) return true;
  for (const k of childrenOf.get(occ?.id) || []) {
    const km = modById.get(k.moduleId);
    if (km?.role === "artifact" && km?.fileRef) return true;
  }
  for (const [fid, v] of Object.entries(occ?.fields || {})) {
    if (!mediaFieldIds.has(fid)) continue;
    const val = v?.value;
    if (Array.isArray(val) ? val.length : val) return true;
  }
  return false;
}

/** The whole selection rule, pure so it can be tested without a database. */
export function planMediaTiles({ occurrences, modules }) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const childrenOf = new Map();
  for (const o of occurrences) {
    if (!o.parentId) continue;
    if (!childrenOf.has(o.parentId)) childrenOf.set(o.parentId, []);
    childrenOf.get(o.parentId).push(o);
  }
  const mediaFieldIds = new Set();
  for (const m of modules)
    for (const b of m.fieldBindings || [])
      if (b.role === "media" || b.role === "files") mediaFieldIds.add(b.fieldId);

  const considered = [];
  for (const b of occurrences) {
    const bm = modById.get(b.moduleId);
    if (bm?.role !== "container" || bm?.kind !== "board") continue;
    const rows = (b.occurrences || []).map((id) => occById.get(id)).filter(Boolean);
    if (rows.length < MIN_ROWS) continue;

    // Is this a MEDIA board? Its rows are media-kind artifacts.
    const mediaRows = rows.filter((r) => {
      const rm = modById.get(r.moduleId);
      return rm?.role === "artifact" && MEDIA_KINDS.includes(rm?.kind);
    });
    if (mediaRows.length / rows.length < COVERAGE_THRESHOLD) continue;

    const withPic = rows.filter((r) => rowHasPicture(r, { modById, childrenOf, mediaFieldIds })).length;
    const coverage = withPic / rows.length;
    const label = b.label ?? bm?.label ?? "(none)";
    considered.push({
      id: b.id, label, rows: rows.length, withPic, coverage,
      tile: coverage >= COVERAGE_THRESHOLD,
      current: b.meta?.layoutCascadeOverride || null,
    });
  }
  return {
    targets: considered.filter((c) => c.tile),
    refused: considered.filter((c) => !c.tile),
  };
}

/** Merge the tile keys over whatever the board already carries. */
export function mergeTileLayout(current) {
  return { ...(current || {}), ...TILE_LAYOUT };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occurrences, modules] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);

  const { targets, refused } = planMediaTiles({ occurrences, modules });

  for (const r of refused)
    log(`  REFUSED "${r.label}" — ${r.withPic}/${r.rows} rows carry a picture (${Math.round(r.coverage * 100)}%); a tile with no picture is a taller row`);

  if (!targets.length) { log("no media board meets the coverage threshold — nothing to do."); return; }

  let changed = 0;
  for (const t of targets) {
    const next = mergeTileLayout(t.current);
    const already = JSON.stringify(t.current || {}) === JSON.stringify(next);
    log(`  ${already ? "already tiled" : "TILE"} "${t.label}" — ${t.withPic}/${t.rows} pictured (${Math.round(t.coverage * 100)}%), mode=${t.current?.mode ?? "-"}->wrap, w<=${TILE_LAYOUT.childMaxWidth}, h<=${TILE_LAYOUT.childMaxHeight}`);
    if (already) continue;
    changed++;
    if (!dryRun) await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.layoutCascadeOverride": next } });
  }

  log(`\nplan: ${changed} board(s) to tile, ${targets.length - changed} already tiled, ${refused.length} refused`);
  if (dryRun) log("DRY RUN — nothing written.");
}
