// 0456 — the Trackers page's LAST line of tiles fills the row too (user, 2026-10-29: "make it so the trackers extend
// the entire panel responsively, instead of stopping short. have the row take up the entire space"). 0438 turned on
// Fill, so full lines already share the width; a short last line (Streak alone in Today's Stats) still stopped at a
// third of the row. `childFillLast` (Layout menu › Last line stretches too) lets those tiles grow into the room.
// Set on every occurrence under the page whose own wrap layout has Fill on. Editable afterwards in each Layout menu.
export const id = "0456-trackers-last-line-fills";
export const describe = "Turns on 'Last line stretches too' on every filled wrap layout under the Trackers page.";
export const touches = ["occurrences"];

const TRACKERS_PAGE = "5zaCM_ScvI7n";

/** The occurrence ids under the page (the page included) whose own layout fills but not its last line. Pure. */
export function planFillLast(rootId, byId) {
  const out = []; const seen = new Set(); const stack = [rootId];
  while (stack.length) {
    const id = stack.pop(); if (seen.has(id)) continue; seen.add(id);
    const o = byId.get(id); if (!o) continue;
    const lc = o.meta?.layoutCascade;
    if (lc?.mode === "wrap" && lc.childFill === true && lc.childFillLast !== true) out.push(id);
    for (const c of o.occurrences || []) stack.push(c);
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  if (!(await Occurrence.exists({ gridId, id: TRACKERS_PAGE }))) { log("  REFUSED: the Trackers page is not on this grid"); throw new Error("no page"); }
  const load = async () => new Map((await Occurrence.find({ gridId }).select("id occurrences meta.layoutCascade label").lean()).map((o) => [o.id, o]));
  const byId = await load();
  const ids = planFillLast(TRACKERS_PAGE, byId);
  log(`  last line fills on ${ids.length}: ${ids.map((id) => byId.get(id)?.label || id).join(", ")}`);
  if (dryRun || !ids.length) return;
  await Occurrence.updateMany({ gridId, id: { $in: ids } }, { $set: { "meta.layoutCascade.childFillLast": true, updatedAt: new Date() } });
  const left = planFillLast(TRACKERS_PAGE, await load());
  if (left.length) throw new Error(`${left.length} still without it`);
  log("  applied. RESTART pm2.");
}
