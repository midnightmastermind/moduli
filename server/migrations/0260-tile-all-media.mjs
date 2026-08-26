/**
 * 0260 — every media board becomes wrapping tiles, like Movies.
 *
 * User, 2026-08-26: *"could you give all the media the same layout treatment as
 * movies. to make them wrappable tiles"*.
 *
 * ── THE RULE THAT REFUSED THEM HAS BEEN ANSWERED, NOT DROPPED ───────────
 *
 * `0248` tiled Movies and TV Series and refused the music and book boards on a
 * rule worth keeping — *"a tile with no picture is a taller row"*. That refusal
 * was correct then: those boards had **zero** artwork. `0254`-`0259` changed the
 * fact rather than the rule:
 *
 * ```
 * Songs 5,484 · Bookmarks 1,467 · Artists 1,679 · Albums 3,027 · Books 877
 *                          all 100% pictured
 * ```
 *
 * So the same threshold that refused them now passes them, and nothing about the
 * test has been weakened to get here.
 *
 * ── SELECTED BY WHERE THEY LIVE, NOT BY A LIST OF NAMES ─────────────────
 *
 * "All the media" is expressible structurally: a board whose page sits under the
 * **Media folder** (including its `Music` and `Books` sub-folders). That is why
 * this migration names no board — rename one, add one, and the rule still holds.
 * A board that drops below the coverage threshold is refused with its number, so
 * a future import of artless rows cannot quietly become empty boxes.
 *
 * ── THE SHAPE IS IMPORTED, NOT RESTATED ─────────────────────────────────
 *
 * Width comes from `0250`'s house-shape vote (the tracker tiles, 184) and the
 * height from `0252` (440, measured from the rendered content of a pictured
 * tile). Restating either number here would be a third copy to drift.
 *
 * ── REPORTED: BOOKMARKS ARE MOSTLY FAVICONS ─────────────────────────────
 *
 * Bookmarks is under Media and is 100% "covered", so it qualifies — but `0201`
 * measured what those covers actually are: 55 real og:images, 151 declared
 * icons and 231 guessed `/favicon.ico`. A favicon at 184px is a small glyph in a
 * large box. It is tiled because it is media and the ask was "all", and this is
 * written down so the result is not a surprise.
 */
import { TILE_H } from "./0252-media-tiles-fit-fields.mjs";
import { planTileSizeMatch, findMediaBoards, RENDERER_DEFAULTS } from "./0250-media-tiles-match-trackers.mjs";
import { MEDIA_KINDS } from "./0248-media-boards-tile.mjs";

export const id = "0260-tile-all-media";
export const describe =
  "Tiles every board under the Media folder that is at least 80% pictured — Songs, Albums, Artists, Books, Bookmarks — with the same width as the tracker tiles and the same height as the Movies tiles.";
export const touches = ["occurrences"];

export const COVERAGE_THRESHOLD = 0.8;
export const MIN_ROWS = 4;
export const MEDIA_FOLDER = "Media";

/** Walk a folder chain to its root, newest-first. */
export function folderChain(folderId, folderById) {
  const out = [];
  let cur = folderById.get(folderId);
  let depth = 0;
  while (cur && depth++ < 8) { out.push(cur.name); cur = folderById.get(cur.parentId); }
  return out;
}

/** Pure. Which boards are media, how covered they are, and which to tile. */
export function planTileAllMedia({ occurrences, modules, folders, houseSize }) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const folderById = new Map((folders || []).map((f) => [f.id, f]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";

  const targets = [], refused = [];
  for (const b of occurrences) {
    const bm = modById.get(b.moduleId);
    if (bm?.role !== "container" || bm?.kind !== "board") continue;
    const rows = (b.occurrences || []).map((i) => occById.get(i)).filter(Boolean);
    if (rows.length < MIN_ROWS) continue;

    // Is it MEDIA? The page that lists this board lives under the Media folder.
    const page = occurrences.find((o) => (o.occurrences || []).includes(b.id));
    const chain = page?.parentId ? folderChain(page.parentId, folderById) : [];
    if (!chain.includes(MEDIA_FOLDER)) continue;

    const pictured = rows.filter((r) => r.meta?.cover || modById.get(r.moduleId)?.meta?.cover).length;
    const coverage = pictured / rows.length;
    const ov = b.meta?.layoutCascadeOverride || {};
    const entry = { id: b.id, label: labelOf(b), rows: rows.length, pictured, coverage, already: ov.mode === "wrap" };
    if (coverage < COVERAGE_THRESHOLD) { refused.push(entry); continue; }
    targets.push({
      ...entry,
      next: {
        ...ov, mode: "wrap", childContentDirection: "column",
        childMinWidth: houseSize.childMinWidth ?? RENDERER_DEFAULTS.childMinWidth,
        childMaxWidth: houseSize.childMinWidth ?? RENDERER_DEFAULTS.childMinWidth,
        childMaxHeight: TILE_H,
      },
    });
  }
  return { targets, refused };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const [occurrences, modules, folders] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Folder.find({ gridId }).lean(),
  ]);

  // The house shape, voted on by the tracker tiles — imported, never restated.
  const mediaBoardIds = findMediaBoards({ occurrences, modules, MEDIA_KINDS });
  const shape = planTileSizeMatch({ occurrences, modules, mediaBoardIds });
  if (shape.refusals?.length) { for (const r of shape.refusals) log(`  REFUSING — ${r}`); return; }
  log(`house tile shape: width ${shape.houseSize.childMinWidth} (from ${shape.votes} wrap containers) · height ${TILE_H} (0252, measured)`);

  const { targets, refused } = planTileAllMedia({ occurrences, modules, folders, houseSize: shape.houseSize });
  for (const r of refused)
    log(`  REFUSED "${r.label}" — ${r.pictured}/${r.rows} pictured (${Math.round(r.coverage * 100)}%); a tile with no picture is a taller row`);

  let changed = 0;
  for (const t of targets) {
    if (t.already) { log(`  already tiled: "${t.label}" (${t.rows} rows)`); continue; }
    log(`  TILE "${t.label}" — ${t.rows} rows, ${Math.round(t.coverage * 100)}% pictured`);
    changed++;
    if (!dryRun) await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.layoutCascadeOverride": t.next } });
  }
  log(`\nplan: ${changed} board(s) tiled, ${targets.length - changed} already, ${refused.length} refused`);
  if (dryRun) log("DRY RUN — nothing written.");
}
