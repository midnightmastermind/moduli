// server/migrations/0400-combine-filter-switch.mjs
//
// User 2026-10-13: "the true and false field input for that in the filter menu doesnt have one set …
// and it should be a switch". 5aac6cc8 made a boolean filter default to a switch, but 0397 stored
// style "pills" on the Schedule page's Combine Schedule filter, and a stored style wins over the
// default. Drop that style so the filter falls back to the switch (the rebuild's, made by clicking,
// never carried one).

export const id = "0400-combine-filter-switch";
export const describe = "The Schedule page's Combine Schedule filter shows as a switch (drop the stored pills style).";
export const touches = ["occurrences"];

/** PURE. The page's filters[] without a style on the given field's filter, or null when nothing changes. */
export function withoutPillsStyle(filters, fieldId) {
  let changed = false;
  const next = (filters || []).map((f) => {
    if (f.fieldId !== fieldId || f.style !== "pills") return f;
    changed = true;
    const { style, ...rest } = f;
    return rest;
  });
  return changed ? next : null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Field, Occurrence } = models;
  const grid = await Grid.findById(gridId).lean();
  const pageId = grid?.meta?.scheduleFieldIds?.pageOccurrenceId;
  if (!pageId) throw new Error("0400: grid.meta.scheduleFieldIds.pageOccurrenceId is not set");
  const field = await Field.findOne({ gridId, name: "Combine Schedule" }).lean();
  if (!field) { log("no Combine Schedule field — nothing to do"); return; }
  const page = await Occurrence.findOne({ id: pageId, gridId }).lean();
  if (!page) throw new Error(`0400: Schedule page ${pageId} not found`);
  const filters = withoutPillsStyle(page.filters, field.id);
  if (!filters) { log("filter already has no pills style"); return; }
  log("- style pills on the Combine Schedule filter");
  if (!dryRun) await Occurrence.updateOne({ id: pageId, gridId }, { $set: { filters } });
  log("done. Restart the server (pm2).");
}
