// 0420 — a reading that is read a chapter a day, not by date.
//
// User, 2026-10-18: *"can you add one of my daoist or buddhist reflection books into my daypage
// reflections"*. The day-page readings (0402) only knew books with one entry per calendar day
// ("October 18"). The Buddhist daily-readings pdf is dated but its text layer is scrambled (no date
// can be found in it, 2026-10-15 (9)), so the Daoist one is used: 81 chapters, one a day in turn.
//
// A $readings entry may now carry `cycle` (one start marker per chapter) and `to` (where a chapter's
// text ends); "Day Page: Readings" picks the chapter from the day of the year. This migration
// rebuilds the stored caller from 0402's builder (keeping its readings and its gate) and adds the
// book named by READING_FILE_OCC (so no title is written into git) with READING_CYCLE chapters.
//
//   READING_FILE_OCC=<file occurrence>  READING_CYCLE=81  [READING_TO=/General Comment/]
//   [READING_TITLE=<label>]  — default: the file's label up to its first ":".
//
// The markers (0402 `chapterMarkers`) fit a book whose chapters open "N" then "1 . <verse>"; checked
// against the whole text of the book used here: all 81 found, each at its own chapter, in order, and
// "General Comment" ends every one within 4,000 characters.

import { CALLER, readingEntry, readingsPipeline, chapterMarkers } from "./0402-day-page-readings.mjs";

export const id = "0420-day-page-chapter-a-day-reading";
export const describe = "Day page readings: a book read a chapter a day (by day of the year).";
export const touches = ["operations"];

/** PURE. The caller's gate (0402 wrapped the body in Day Page: Build's gate when it had one). */
export function callerGate(steps = []) {
  const first = steps[1];
  if (first?.type !== "if") return null;
  const usesPeriod = JSON.stringify(first.condition || {}).includes("$activePeriodCount");
  return usesPeriod ? null : first.condition;
}

/** PURE. The caller's readings list, from its INIT_VAR. */
export function readingsOf(steps = []) {
  const init = steps.find((s) => s?.config?.type === "INIT_VAR" && s.config.name === "$readings");
  return JSON.parse(String(init?.config?.expr || "json:[]").slice(5));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation } = models;
  const caller = await Operation.findOne({ gridId, name: CALLER }).lean();
  if (!caller) throw new Error(`0420: no "${CALLER}" on this grid (run 0402 first)`);
  const steps = caller.pipeline?.steps || [];
  const readings = readingsOf(steps);
  const gate = callerGate(steps);

  const fileOccId = process.env.READING_FILE_OCC;
  if (fileOccId) {
    const cycleLen = Number(process.env.READING_CYCLE);
    if (!Number.isInteger(cycleLen) || cycleLen < 1) throw new Error("0420: READING_CYCLE must be the chapter count");
    const occ = await Occurrence.findOne({ id: fileOccId, gridId }).lean();
    const mod = occ && await Module.findOne({ id: occ.moduleId || occ.targetId }).lean();
    if (!mod?.fileRef || (mod.kind !== "pdf" && mod.kind !== "ebook")) throw new Error(`0420: ${fileOccId} is not a pdf / e-book file`);
    const title = String(process.env.READING_TITLE || String(occ.label || mod.label || "Reading").split(":")[0]).trim();
    const entry = { ...readingEntry({ title, fileRef: mod.fileRef, kind: mod.kind }),
      cycle: chapterMarkers(cycleLen), to: process.env.READING_TO || "/General Comment/" };
    const at = readings.findIndex((x) => x.file === entry.file);
    if (at >= 0) readings[at] = entry; else readings.push(entry);
    log(`${at >= 0 ? "~" : "+"} reading ${entry.title} (${cycleLen} chapters, one a day)`);
  }

  const pipeline = readingsPipeline({ readings, gateCondition: gate });
  log(`rewrite ${CALLER}: ${readings.length} reading(s), gate ${gate ? "kept" : "none"}`);
  if (dryRun) return;
  await Operation.updateOne({ id: caller.id }, { $set: { pipeline } });
  const back = await Operation.findOne({ id: caller.id }).lean();
  if (!JSON.stringify(back.pipeline).includes("MOD_VAR")) throw new Error("0420: the caller did not take the cycle branch");
  log("done. Restart the server (pm2).");
}
