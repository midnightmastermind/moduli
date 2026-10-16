// server/migrations/0403-day-page-reading-retry.mjs
//
// "Day Page: Add Reading" (0402) marks a day BEFORE it waits on the read, so a second run on the same
// load does not import the passage twice. But a read that found no passage, or an import that failed,
// left the mark on and the day was never tried again. The callee now takes the mark back off in that
// case. This rewrites the existing op's steps with 0402's current builder; the board and date field
// are read off the op's own first FIND, so nothing here names them.

import { CALLEE, addReadingPipeline } from "./0402-day-page-readings.mjs";

export const id = "0403-day-page-reading-retry";
export const describe = "Day page readings: a failed read or import is tried again on the next load.";
export const touches = ["operations"];

export function readBoardAndDate(op) {
  const rules = op?.pipeline?.steps?.[0]?.config?.predicate?.rules || [];
  const board = rules.find((x) => x.left === "parentId" && x.comparator === "IS")?.right;
  const date = rules.map((x) => /^fields\.([^.]+)\.value$/.exec(x.left || "")?.[1]).find(Boolean);
  return board && date ? { boardOccurrenceId: board, dateFieldId: date } : null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: CALLEE }).lean();
  if (!op) { log(`no "${CALLEE}" on this grid — nothing to do`); return; }
  const where = readBoardAndDate(op);
  if (!where) throw new Error(`0403: could not read the board / date field off "${CALLEE}"`);
  if (JSON.stringify(op.pipeline).includes('"$importError"')) { log(`${CALLEE} already retries`); return; }
  log(`~ ${CALLEE}: retry on a failed read (board ${where.boardOccurrenceId}, date ${where.dateFieldId})`);
  if (!dryRun) await Operation.updateOne({ id: op.id }, { $set: { pipeline: addReadingPipeline(where) } });
  log("done. Restart the server (pm2).");
}
