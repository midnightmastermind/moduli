/**
 * 0252 — a media tile gets tall enough to SHOW its fields.
 *
 * User, 2026-08-25: *"make it larger than to see the fields"*
 *
 * ── WHAT `0250` COST, MEASURED ON THE LIVE GRID ─────────────────────────
 *
 * `0250` matched the media tiles to the tracker tiles at the user's request —
 * 184 x 200. A tracker tile has no picture, so its label and fields fit
 * comfortably. A media tile's POSTER alone is taller than the whole tile:
 *
 * ```
 * tile height   200px        actual content   432px       overflow: hidden
 * poster        top  12,  h 218   -> clipped at the bottom
 * title         top 261          -> below the cap, invisible
 * fields        top 288,  h 144  -> invisible (Owned · Drive · Size)
 * ```
 *
 * And `overflow: hidden` sits on the tile, so they could not be scrolled to
 * either — the fields were unreachable, not merely cramped.
 *
 * ── THE HEIGHT IS MEASURED, NOT GUESSED ─────────────────────────────────
 *
 * `TILE_H` is the tiles' own rendered `scrollHeight` on the live Movies board
 * (p90 and max both **432**), plus a little slack. It is `childMaxHeight` — an
 * ordinary cascade key the Layout menu edits — so it is a starting point the
 * user can drag, not a constant baked into a renderer.
 *
 * ── ONLY THE BOARDS THAT HAVE A PICTURE ─────────────────────────────────
 *
 * Games and Comics are tiled too (`0251`, the user's call) but carry **no cover
 * art**, so their rows are title + fields and already fit the 200 the trackers
 * use. Raising them to 440 would buy nothing and leave two boards of
 * two-thirds-empty tiles. The pictured/unpictured split is `0248`'s own
 * coverage rule, imported rather than restated so the two cannot disagree.
 */

export const id = "0252-media-tiles-fit-fields";
export const describe =
  "Raises childMaxHeight on the media boards that carry cover art so the poster, title and fields all fit (measured 432px of content at 184 wide). Boards with no artwork keep the tracker height.";
export const touches = ["occurrences"];

/** Measured on the live Movies board: content scrollHeight p90 = max = 432. */
export const TILE_H = 440;

export function planTileHeights({ occurrences, modules, planMediaTiles }) {
  const { targets } = planMediaTiles({ occurrences, modules });
  const out = [];
  for (const t of targets) {
    const occ = occurrences.find((o) => o.id === t.id);
    const ov = occ?.meta?.layoutCascadeOverride || {};
    if (ov.mode !== "wrap") continue;                 // only actual tiles
    out.push({
      id: t.id, label: t.label, from: ov.childMaxHeight ?? null,
      already: ov.childMaxHeight === TILE_H,
      next: { ...ov, childMaxHeight: TILE_H },
    });
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const { planMediaTiles } = await import("./0248-media-boards-tile.mjs");
  const [occurrences, modules] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const targets = planTileHeights({ occurrences, modules, planMediaTiles });
  if (!targets.length) { log("no pictured media tile on this grid — nothing to do."); return; }

  let changed = 0;
  for (const t of targets) {
    if (t.already) { log(`  already ${TILE_H}px: "${t.label}"`); continue; }
    log(`  "${t.label}"  childMaxHeight ${t.from ?? "unset -> 200"} -> ${TILE_H}  (content measures 432px)`);
    changed++;
    if (!dryRun) await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.layoutCascadeOverride": t.next } });
  }
  log(`\nplan: ${changed} board(s) raised; boards with no cover art keep the tracker height`);
  if (dryRun) log("DRY RUN — nothing written.");
}
