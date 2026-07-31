// User, 2026-07-31: "could you make the view side by side like the schedule for
// the daypage containers".
//
// The Schedule lays its day-columns out horizontally because Build Schedule
// stamps `mode: "flex-row"` into the page's layout cascade; the Day Page board
// was never given one, so it fell to the default vertical stack and each day
// took the full width. PageBoard consumes the shape generically — no renderer
// knows what a "day" is — so this is a data change, not a code one.
//
// Written to `meta.layoutCascade` (the surface's own push-down slot), which is
// the same key the page header's Layout menu writes. That means the user can
// change the arrangement from the UI afterwards and their choice replaces this
// one instead of fighting an op that rewrites it every build.
//
// `sortChildrenByField` keeps the columns in date order: the board appends new
// day columns in the order they are built, which is picker-selection order, not
// chronological.

export const id = "0025-day-page-side-by-side";
export const describe =
  "Lays the Day Page board out in side-by-side columns (mode flex-row) ordered by date, matching the " +
  "Schedule. Written to the same cascade slot the header's Layout menu writes, so it can be changed in-app.";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const dateFieldId = grid?.meta?.scheduleFieldIds?.dateFieldId || null;
  if (!dateFieldId) log("! grid.meta.scheduleFieldIds.dateFieldId missing — columns will keep insertion order");

  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  if (!boardMod) { log("no Day Page board on this grid"); return; }
  const boardOcc = await Occurrence.findOne({ gridId, moduleId: boardMod.id })
    .select({ id: 1, meta: 1 }).lean();
  if (!boardOcc) { log("Day Page board module has no occurrence"); return; }

  const shape = {
    mode: "flex-row",
    childGap: 12,
    // Cap each day column and let it scroll inside itself (user: "the daypage
    // containers should have a height max. right now it expands and messes up
    // the add new item menu"). An uncapped column grows with its content, so
    // anything that changes height on hover shoves everything below it and the
    // hover target slides out from under the pointer.
    childMaxHeight: 600,
    ...(dateFieldId ? { sortChildrenByField: dateFieldId } : {}),
  };
  const current = boardOcc.meta?.layoutCascade || null;
  if (current && current.mode === shape.mode && current.sortChildrenByField === shape.sortChildrenByField
      && current.childMaxHeight === shape.childMaxHeight) {
    log("Day Page board already lays out side by side");
    return;
  }

  log(`Day Page board → ${JSON.stringify(shape)}`);
  if (!dryRun) {
    // Whole-object write: meta may be null, and a dotted $set cannot create a
    // field inside a null (the 0021 lesson).
    await Occurrence.updateOne({ gridId, id: boardOcc.id }, {
      $set: { meta: { ...(boardOcc.meta || {}), layoutCascade: { ...(current || {}), ...shape } } },
    });
  }
}
