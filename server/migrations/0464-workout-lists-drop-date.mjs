// 0464 — Workout Log's lists drop their Date column (user, 2026-10-30: "its still showing the Date"). The tile shows its
// own Tracker Date, and every row of a list is that day, so the column repeated it. Cardio and Workouts.
export const id = "0464-workout-lists-drop-date";
export const describe = "Removes the Date column from Workout Log's Cardio and Workouts lists.";
export const touches = ["fields"];

export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const fields = await Field.find({ gridId, name: { $in: ["Cardio", "Workouts"] } }).lean();
  for (const f of fields) {
    const cols = f.displayConfig?.columns || [];
    const next = cols.filter((c) => c.path !== "date");
    log(`  ${f.name}: ${cols.length} -> ${next.length} columns`);
    if (!dryRun && next.length !== cols.length) await Field.updateOne({ gridId, id: f.id }, { $set: { "displayConfig.columns": next, updatedAt: new Date() } });
  }
  if (!dryRun) log("  applied. RESTART pm2.");
}
