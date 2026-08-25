/**
 * 0251 — Games and Comics become tiles too, at the user's instruction.
 *
 * User, 2026-08-25: *"games and comics should be tiles too"*
 *
 * ── THIS DELIBERATELY OVERRIDES `0248`'s MEASURED REFUSAL ────────────────
 *
 * `0248` tiled the media boards that had pictures and REFUSED the two that did
 * not, on a rule this repo had already earned — *"a tile with no picture is a
 * taller row"* (2026-08-25, which used it to refuse Songs, Albums, Artists and
 * Books):
 *
 * ```
 * Movies 989/993 100%   TV Series 183/187 98%   -> tiled by 0248
 * Games    0/4     0%   Comics      0/5    0%   -> REFUSED by 0248
 * ```
 *
 * TMDB is a film/TV database, so neither board got a poster. The concern was
 * raised and the user's answer is explicit, so it is theirs to make: they are
 * tiled. **The coverage rule is not deleted** — it still governs `0248` and the
 * music/book boards it refuses. This migration names two boards the user asked
 * for, rather than dropping the threshold and quietly sweeping in Songs (5,489
 * rows) and Albums (3,027) with it.
 *
 * ── SAME SHAPE AS EVERYTHING ELSE, READ NOT RESTATED ─────────────────────
 *
 * The dimensions come from `0250`'s house-shape vote (the tracker tiles), so
 * these two cannot drift from the other tiles the moment anyone changes one
 * from the Layout menu. `childContentDirection: "column"` rides along for the
 * same reason Movies has it — a row composes as picture -> title -> fields, and
 * a board with no picture simply has nothing to put on top.
 */

export const id = "0251-tile-games-and-comics";
export const describe =
  "Tiles the two media boards 0248 refused for having no cover art (Games, Comics), at the user's explicit instruction. Dimensions are read from the house tile shape, not restated.";
export const touches = ["occurrences"];

/** The boards the user named, matched STRUCTURALLY by the kind of row they hold. */
export const KINDS_TO_TILE = Object.freeze(["game", "comic"]);

export function planTileByKind({ occurrences, modules, kinds, houseSize }) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const targets = [];
  for (const b of occurrences) {
    const bm = modById.get(b.moduleId);
    if (bm?.role !== "container" || bm?.kind !== "board") continue;
    const rows = (b.occurrences || []).map((id) => occById.get(id)).filter(Boolean);
    if (!rows.length) continue;
    const matching = rows.filter((r) => {
      const rm = modById.get(r.moduleId);
      return rm?.role === "artifact" && kinds.includes(rm?.kind);
    });
    if (matching.length / rows.length < 0.8) continue;
    const ov = b.meta?.layoutCascadeOverride || {};
    targets.push({
      id: b.id, label: b.label ?? bm?.label ?? "?", rows: rows.length,
      already: ov.mode === "wrap",
      next: { ...ov, mode: "wrap", childContentDirection: "column", ...houseSize,
              childMaxWidth: houseSize.childMinWidth ?? 132 },
    });
  }
  return targets;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const { planTileSizeMatch, findMediaBoards } = await import("./0250-media-tiles-match-trackers.mjs");
  const { MEDIA_KINDS } = await import("./0248-media-boards-tile.mjs");
  const [occurrences, modules] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);

  // Reuse 0250's vote so these two land on the SAME shape as every other tile.
  const mediaBoardIds = findMediaBoards({ occurrences, modules, MEDIA_KINDS });
  const shape = planTileSizeMatch({ occurrences, modules, mediaBoardIds });
  if (shape.refusals?.length) { for (const r of shape.refusals) log(`  REFUSING — ${r}`); return; }
  const d = shape.houseSize;
  log(`house tile shape (from ${shape.votes} wrap containers): childMinWidth ${d.childMinWidth} · childMaxHeight ${d.childMaxHeight ?? "unset"} · childGap ${d.childGap ?? "unset"}`);

  const targets = planTileByKind({ occurrences, modules, kinds: KINDS_TO_TILE, houseSize: d });
  if (!targets.length) { log("no game/comic board on this grid — nothing to do."); return; }

  let changed = 0;
  for (const t of targets) {
    if (t.already) { log(`  already tiled: "${t.label}" (${t.rows} rows)`); continue; }
    log(`  TILE "${t.label}" — ${t.rows} rows, no cover art (the user's call, overriding 0248's refusal)`);
    changed++;
    if (!dryRun) await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.layoutCascadeOverride": t.next } });
  }
  log(`\nplan: ${changed} board(s) tiled, ${targets.length - changed} already tiled`);
  if (dryRun) log("DRY RUN — nothing written.");
}
