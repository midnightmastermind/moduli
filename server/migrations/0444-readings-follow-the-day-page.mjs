// 0444 — readings follow the Day Page's own date (user, 2026-10-26: "tomorrows reflections are still not there").
// "Day Page: Readings" loops $activePeriodDates, which the executor reads from the op's target page — and it had
// none, so it read the TOOLBAR's date. With the toolbar on Oct 26 and the Day Page on Oct 27 it kept importing (or
// finding already imported) Oct 26's readings and never reached Oct 27. Day Page: Build is targeted at the Day Page;
// the readings op now is too.
export const id = "0444-readings-follow-the-day-page";
export const describe = "Targets 'Day Page: Readings' at the Day Page (Day Page: Build's target), so it imports readings for the days the Day Page shows rather than the toolbar's.";
export const touches = ["operations"];

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const build = await Operation.findOne({ gridId, name: "Day Page: Build" }).lean();
  const readings = await Operation.findOne({ gridId, name: "Day Page: Readings" }).lean();
  if (!build?.targetOccurrenceId || !readings) throw new Error("missing Day Page: Build's target or Day Page: Readings");
  if (readings.targetOccurrenceId === build.targetOccurrenceId) { log("  already targeted"); return; }
  log(`  Day Page: Readings target ${readings.targetOccurrenceId} -> ${build.targetOccurrenceId}`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: readings.id }, { $set: { targetOccurrenceId: build.targetOccurrenceId, updatedAt: new Date() } });
  log("  applied. RESTART pm2.");
}
