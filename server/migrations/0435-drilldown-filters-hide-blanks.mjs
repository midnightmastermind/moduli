// 0435 — the music drill-down's board filters hide rows with no value (user, 2026-10-26: an album with no artist
// showed under every artist). Turns on the filter's own "hide rows with no value" setting (filters[].hideEmpty) on the Albums
// board's Artist filter and the Songs board's Album filter — the box in the filter's editor.
export const id = "0435-drilldown-filters-hide-blanks";
export const describe = "Turns on Hide blanks for the Albums board's Artist filter and the Songs board's Album filter (0434). Deletes nothing.";
export const touches = ["occurrences"];

const TARGETS = [{ board: "9u204s73cxy8", fieldId: "8wotshpcdlog" }, { board: "omK6EzlhYDoQ", fieldId: "9i0yaflshggo" }];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  for (const t of TARGETS) {
    const occ = await Occurrence.findOne({ gridId, id: t.board }).lean();
    const f = (occ?.filters || []).find((x) => x.fieldId === t.fieldId);
    if (!f) { log(`  REFUSED: ${t.board} has no filter on ${t.fieldId} (run 0434 first)`); throw new Error("filter missing"); }
    if (f.hideEmpty) { log(`  ${t.board}: already on`); continue; }
    log(`  ${t.board}: Hide blanks on`);
    if (!dryRun) await Occurrence.updateOne({ gridId, id: t.board, "filters.fieldId": t.fieldId }, { $set: { "filters.$.hideEmpty": true, updatedAt: new Date() } });
  }
}
