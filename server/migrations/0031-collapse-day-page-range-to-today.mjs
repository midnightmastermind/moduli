// User chose option 2 (2026-08-01): when a new day starts, a page showing a
// multi-day RANGE collapses to today.
//
// The Day Page board was pinned to { value:"2026-07-30", span:2, kind:"range" }.
// `Grid: Snap Filter To Today` does not advance range shapes, and its
// "Last Opened" marker was already stamped 2026-08-01 — so it believed it had
// done its job and would never retry. Today's column could not be built because
// `Day Page: Build` only builds the days the filter names.
//
// This collapses the stuck range to a single day. NOTE the scope: it fixes the
// grid that is stuck TODAY. The durable half — teaching the snap op to collapse
// a range on a new day, so this cannot recur next time a range is picked — is a
// change to a SHARED op that governs every date-carrying page on the grid, and
// belongs in its own reviewed pass.

export const id = "0031-collapse-day-page-range-to-today";
export const describe =
  "Collapses the Day Page board's stuck multi-day range filter to a single day so today's column can " +
  "build. The snap op still cannot advance range shapes — that fix is separate.";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const dateFieldId = grid?.meta?.scheduleFieldIds?.dateFieldId;
  if (!dateFieldId) { log("grid.meta.scheduleFieldIds.dateFieldId missing"); return; }

  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  const boardOcc = boardMod
    ? await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ id: 1, filterOverride: 1 }).lean()
    : null;
  if (!boardOcc) { log("no Day Page board on this grid"); return; }

  const cur = boardOcc.filterOverride?.[dateFieldId] || null;
  if (!cur) { log("board has no date override — it already inherits the grid's date"); return; }
  if (cur.kind !== "range" && cur.kind !== "multi" && !cur.span) {
    log(`board is already a single day (${cur.value}) — nothing to collapse`);
    return;
  }

  // Local-day string, matching the executor's $today (NOT toISOString, which
  // rolls a day west of UTC — the 2026-04-29 lesson).
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  log(`collapsing ${JSON.stringify(cur)} → { value: "${today}", unit: "day" }`);
  if (!dryRun) {
    await Occurrence.updateOne({ gridId, id: boardOcc.id }, {
      $set: { filterOverride: { ...(boardOcc.filterOverride || {}), [dateFieldId]: { value: today, unit: "day" } } },
    });
  }
}
