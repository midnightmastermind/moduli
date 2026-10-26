// 0438 — the Trackers page's tiles share the whole width, like the Books board (user, 2026-10-26: "do to the
// trackers that we did with the books board and make it use the entire width instead of predefined widths").
// Every container under the Trackers page lays its tiles out as a wrap grid of 184px squares, so the width left after
// the last tile on a line is a gap. `childFill` (the Books board's setting, Layout menu › Fill) makes each tile
// (row width − gaps) / columns. Set on every occurrence under the page that already carries its own wrap layout
// (and on the page itself); the 184 stays as the smallest a tile gets. Editable afterwards in each Layout menu.
export const id = "0438-trackers-fill-width";
export const describe = "Turns on Fill (tiles share the row's width) on every wrap layout under the Trackers page, as on the Books board.";
export const touches = ["occurrences"];

const TRACKERS_PAGE = "5zaCM_ScvI7n";

/** The occurrence ids under the page (the page included) whose own layout is a wrap without fill. Pure. */
export function planFill(rootId, byId) {
  const out = []; const seen = new Set(); const stack = [rootId];
  while (stack.length) {
    const id = stack.pop(); if (seen.has(id)) continue; seen.add(id);
    const o = byId.get(id); if (!o) continue;
    const lc = o.meta?.layoutCascade;
    if (lc?.mode === "wrap" && lc.childFill !== true) out.push(id);
    for (const c of o.occurrences || []) stack.push(c);
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  if (!(await Occurrence.exists({ gridId, id: TRACKERS_PAGE }))) { log("  REFUSED: the Trackers page is not on this grid"); throw new Error("no page"); }
  const all = await Occurrence.find({ gridId }).select("id occurrences meta.layoutCascade label").lean();
  const byId = new Map(all.map((o) => [o.id, o]));
  const ids = planFill(TRACKERS_PAGE, byId);
  log(`  fill on ${ids.length}: ${ids.map((id) => byId.get(id)?.label || id).join(", ")}`);
  if (dryRun || !ids.length) return;
  await Occurrence.updateMany({ gridId, id: { $in: ids } }, { $set: { "meta.layoutCascade.childFill": true, updatedAt: new Date() } });
  const left = planFill(TRACKERS_PAGE, new Map((await Occurrence.find({ gridId }).select("id occurrences meta.layoutCascade").lean()).map((o) => [o.id, o])));
  if (left.length) throw new Error(`${left.length} still without fill`);
  log("  applied. RESTART pm2.");
}
