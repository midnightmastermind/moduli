// server/migrations/0405-day-page-reading-title.mjs
//
// A day's reading is imported under the book's title. The importer names the page after the passage's
// first heading and ignores the title it is given, so an e-book passage that starts "### October 15th
// TITLE" was imported as a page named after the day. That also broke the callee's "the column already
// holds this reading" check, which looks for the title. 0402's callee now puts `# <title>` above the
// passage (only when a passage was found). This rewrites the stored callee to 0402's pipeline, with the
// board and date field read off it, as 0403 did.

import { CALLEE, addReadingPipeline } from "./0402-day-page-readings.mjs";
import { readBoardAndDate } from "./0403-day-page-reading-retry.mjs";

export const id = "0405-day-page-reading-title";
export const describe = "Day page readings: a passage is imported under the book's title as its top heading.";
export const touches = ["operations"];

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: CALLEE }).lean();
  if (!op) { log(`no "${CALLEE}" on this grid`); return; }
  if (JSON.stringify(op.pipeline).includes("$importMd")) { log(`${CALLEE} already imports under the title`); return; }
  const where = readBoardAndDate(op);
  if (!where) throw new Error(`0405: could not read the board / date field off "${CALLEE}"`);
  const { boardOccurrenceId, dateFieldId } = where;
  log(`${CALLEE}: rewritten (board ${boardOccurrenceId}, date ${dateFieldId})`);
  if (dryRun) return;
  await Operation.updateOne({ id: op.id }, { $set: { pipeline: addReadingPipeline({ boardOccurrenceId, dateFieldId }) } });
  const back = await Operation.findOne({ id: op.id }).lean();
  if (!JSON.stringify(back.pipeline).includes("$importMd")) throw new Error("0405: the callee did not change");
  log("done. Restart the server (pm2).");
}
