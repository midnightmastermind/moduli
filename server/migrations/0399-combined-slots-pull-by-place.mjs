// server/migrations/0399-combined-slots-pull-by-place.mjs
//
// 0397's combined slots matched items by their Time Slot VALUE. Measured 2026-10-13: every Todo item has
// no Time Slot (poms 30, rebuild 20), 18% / 45% of slot items have none, and 41 / 23 sit in a slot that is
// not their own Time Slot (a shift listed in 13 slots carries only its start) — all missing or shown once.
// User (18:55): the Todo slot pulls each picked day's Todo items, and slots pull "by where it sits".
// Each combined slot's feed now lists, OR'ed, `_ancestors HAS_ANCESTOR <that slot in a picked day column>`
// (a day slot is a copy-link of the template slot: meta.copyLinkSource). No picked day with a column ->
// the feed is OFF, never "everything under the page". Replaces the op's pipeline with 0397's builder.

import { combineDaysPipeline, layoutContainerOf, OP_NAME, BUILD_OP, FIELD_NAME } from "./0397-combine-schedule.mjs";

export const id = "0399-combined-slots-pull-by-place";
export const describe = "Schedule: Combine Days slots pull whatever sits in that slot on each picked day.";
export const touches = ["operations"];

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Field, Operation } = models;
  const grid = await Grid.findById(gridId).lean();
  const ids = grid?.meta?.scheduleFieldIds || {};
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" — nothing to do`); return; }
  if (JSON.stringify(op.pipeline).includes("\"$dayColIds\"")) { log("already pulls by place"); return; }
  const field = await Field.findOne({ gridId, name: FIELD_NAME }).lean();
  const layoutContId = layoutContainerOf(await Operation.findOne({ gridId, name: BUILD_OP }).lean());
  if (!field || !layoutContId || !ids.dateFieldId) throw new Error("0399: Combine Schedule field, template container or date field missing");
  const pipeline = combineDaysPipeline({ pageOccurrenceId: ids.pageOccurrenceId, layoutContId, combineFieldId: field.id,
    dateFieldId: ids.dateFieldId, timeslotFieldId: ids.timeslotFieldId, scheduleFormatFieldId: ids.scheduleFormatFieldId });
  log(`replace "${OP_NAME}" pipeline (slots pull by place)`);
  if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  log("done. Restart the server (pm2).");
}
