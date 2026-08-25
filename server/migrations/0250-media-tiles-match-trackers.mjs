/**
 * 0250 — the media tiles become the SAME SIZE as the tracker tiles.
 *
 * User, 2026-08-25: *"make sure the media tiles are tiles though. same size as
 * trackers"*
 *
 * `0248` tiled Movies and TV Series with numbers I picked to suit a 2:3 poster
 * — 150 wide x 320 tall. That is taller and narrower than every other tile on
 * the grid, so they read as a column of cards rather than as tiles:
 *
 * ```
 * tracker tiles   15 containers   childMinWidth 184   (h/gap unset -> 200 / 8)
 * media tiles      2 containers   childMinWidth 150 · childMaxHeight 320 · gap 10
 * ```
 *
 * ── THE NUMBERS ARE READ OFF THE TRACKER TILES, NOT RESTATED ─────────────
 *
 * Hardcoding `184` here would be a second copy of a number the trackers already
 * own, and the two would drift the first time the user changes one from the
 * Layout menu. So the migration FINDS the house tile shape: it groups every
 * wrap-mode container on the grid by its dimensions and takes the largest
 * group, excluding the media boards it is about to rewrite. On poms grid that
 * is the 15 `Today's …` tracker containers.
 *
 * It REFUSES if no group has a clear majority — a guess about "the house shape"
 * is worse than leaving the boards alone and saying so.
 *
 * ── WHAT IS DELIBERATELY *NOT* COPIED ────────────────────────────────────
 *
 * `childContentDirection: "column"` stays on the media boards. The trackers do
 * not set it, but it is what stacks a media row picture -> title -> fields
 * (the 2026-08-25 item 4 ask). The user asked for the SIZE to match, not the
 * composition — a tracker tile has no picture to put on top.
 *
 * `childMaxWidth` is set to the same value as the width rather than left unset
 * as the trackers leave it. That is `0248`'s own ask ("a max width") and it
 * only differs from the trackers in a container too narrow for one tile, where
 * a tracker tile overflows and a media tile shrinks.
 */

export const id = "0250-media-tiles-match-trackers";
export const describe =
  "Resizes the media board tiles to the house tile shape, read off the largest group of wrap-mode containers (the tracker tiles) rather than hardcoded. Refuses if no shape has a clear majority.";
export const touches = ["occurrences"];

/** The renderer's own fallbacks, for reporting what an unset key resolves to. */
export const RENDERER_DEFAULTS = Object.freeze({ childMinWidth: 132, childMaxHeight: 200, childGap: 8 });

/** Keys that describe a tile's SIZE (composition keys are excluded on purpose). */
export const SIZE_KEYS = Object.freeze(["childMinWidth", "childMaxHeight", "childGap"]);

const sizeOf = (ov) => {
  const out = {};
  for (const k of SIZE_KEYS) out[k] = ov?.[k] ?? null;
  return out;
};

/**
 * The whole rule, pure. Returns the house size, the boards to rewrite and any
 * refusal. `mediaBoardIds` are excluded from the vote so the boards being
 * changed cannot elect their own shape.
 */
export function planTileSizeMatch({ occurrences, modules, mediaBoardIds }) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const media = new Set(mediaBoardIds || []);
  const refusals = [];

  const groups = new Map();
  for (const o of occurrences) {
    const ov = o.meta?.layoutCascadeOverride || o.meta?.layoutCascade;
    if (ov?.mode !== "wrap") continue;
    if (media.has(o.id)) continue;                     // never vote for yourself
    const key = JSON.stringify(sizeOf(ov));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o.id);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!ranked.length) { refusals.push("no wrap-mode container to read a house tile shape from"); return { refusals }; }
  const [topKey, topIds] = ranked[0];
  const runnerUp = ranked[1]?.[1]?.length || 0;
  if (topIds.length <= runnerUp) {
    refusals.push(`no clear majority tile shape (${topIds.length} vs ${runnerUp}) — refusing to guess`);
    return { refusals };
  }

  const houseSize = JSON.parse(topKey);
  const targets = [];
  for (const id of media) {
    const o = occurrences.find((x) => x.id === id);
    if (!o) continue;
    const ov = o.meta?.layoutCascadeOverride || {};
    // ONLY boards that are actually TILED. `0248` deliberately left Games and
    // Comics untiled (no posters — "a tile with no picture is a taller row"),
    // and writing tile dimensions onto a board that is not in wrap mode would
    // configure something nothing renders, on boards a previous pass refused
    // on purpose.
    if (ov.mode !== "wrap") continue;
    const already = SIZE_KEYS.every((k) => (ov[k] ?? null) === houseSize[k]);
    targets.push({
      id, label: o.label ?? modById.get(o.moduleId)?.label ?? "?",
      from: sizeOf(ov), already,
      next: { ...ov, ...houseSize, childMaxWidth: houseSize.childMinWidth ?? RENDERER_DEFAULTS.childMinWidth },
    });
  }
  return { houseSize, votes: topIds.length, runnerUp, targets, refusals };
}

/** The media boards, by the same structural rule 0248 used. */
export function findMediaBoards({ occurrences, modules, MEDIA_KINDS }) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const out = [];
  for (const b of occurrences) {
    const bm = modById.get(b.moduleId);
    if (bm?.role !== "container" || bm?.kind !== "board") continue;
    const rows = (b.occurrences || []).map((id) => occById.get(id)).filter(Boolean);
    if (rows.length < 4) continue;
    const mediaRows = rows.filter((r) => {
      const rm = modById.get(r.moduleId);
      return rm?.role === "artifact" && MEDIA_KINDS.includes(rm?.kind);
    });
    if (mediaRows.length / rows.length >= 0.8) out.push(b.id);
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const { MEDIA_KINDS } = await import("./0248-media-boards-tile.mjs");
  const [occurrences, modules] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);

  const mediaBoardIds = findMediaBoards({ occurrences, modules, MEDIA_KINDS });
  log(`media boards: ${mediaBoardIds.length}`);
  const plan = planTileSizeMatch({ occurrences, modules, mediaBoardIds });
  if (plan.refusals.length) { for (const r of plan.refusals) log(`  REFUSING — ${r}`); return; }

  const d = plan.houseSize;
  log(`house tile shape (from ${plan.votes} wrap containers, runner-up ${plan.runnerUp}):`);
  log(`   childMinWidth ${d.childMinWidth ?? `unset -> ${RENDERER_DEFAULTS.childMinWidth}`} · childMaxHeight ${d.childMaxHeight ?? `unset -> ${RENDERER_DEFAULTS.childMaxHeight}`} · childGap ${d.childGap ?? `unset -> ${RENDERER_DEFAULTS.childGap}`}`);

  let changed = 0;
  for (const t of plan.targets) {
    if (t.already) { log(`  already matches: "${t.label}"`); continue; }
    log(`  "${t.label}"  w ${t.from.childMinWidth} -> ${d.childMinWidth ?? "unset"} · h ${t.from.childMaxHeight} -> ${d.childMaxHeight ?? "unset"} · gap ${t.from.childGap} -> ${d.childGap ?? "unset"}`);
    changed++;
    if (!dryRun) await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.layoutCascadeOverride": t.next } });
  }
  log(`\nplan: ${changed} board(s) resized, ${plan.targets.length - changed} already matching`);
  if (dryRun) log("DRY RUN — nothing written.");
}
