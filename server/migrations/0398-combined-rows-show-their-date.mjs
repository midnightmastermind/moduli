// server/migrations/0398-combined-rows-show-their-date.mjs
//
// 0397's "Schedule: Combine Days" listed every picked day's items in one column, but a row did not
// show WHICH day it came from — Date is bound hidden on schedule items. The op now sets the combined
// column's field visibility to the Schedule page's own plus `reveal: [Date]` (show a field even where
// it is bound hidden — not a whitelist), so each row is tagged with its date (user, 13:58: "tagged with its date").
// Replaces the op's pipeline with 0397's current builder.

import { combineDaysPipeline, layoutContainerOf, OP_NAME, BUILD_OP, FIELD_NAME } from "./0397-combine-schedule.mjs";

export const id = "0398-combined-rows-show-their-date";
export const describe = "Schedule: Combine Days shows each combined row's date.";
export const touches = ["operations"];

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Field, Operation } = models;
  const grid = await Grid.findById(gridId).lean();
  const ids = grid?.meta?.scheduleFieldIds || {};
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" — nothing to do`); return; }
  const field = await Field.findOne({ gridId, name: FIELD_NAME }).lean();
  const layoutContId = layoutContainerOf(await Operation.findOne({ gridId, name: BUILD_OP }).lean());
  if (!field || !layoutContId || !ids.dateFieldId) throw new Error("0398: Combine Schedule field, template container or date field missing");
  const pipeline = combineDaysPipeline({ pageOccurrenceId: ids.pageOccurrenceId, layoutContId, combineFieldId: field.id,
    dateFieldId: ids.dateFieldId, timeslotFieldId: ids.timeslotFieldId, scheduleFormatFieldId: ids.scheduleFormatFieldId });
  if (JSON.stringify(op.pipeline).includes("\"reveal\"")) { log("already reveals the date"); return; }
  log(`replace "${OP_NAME}" pipeline (+ date tag)`);
  if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  log("done. Restart the server (pm2).");
}
