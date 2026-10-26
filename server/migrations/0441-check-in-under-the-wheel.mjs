// 0441 — a picked mood's Check In shows under the Emotions Wheel, not under Reflections (user, 2026-10-26: "the
// moods i select need to show up underneath the emotions wheel not underneath reflections"). 0343 appended the new
// Check In's embed at the END of the day column, and Day Page: Build keeps the Reflections section last, so a fresh
// pick showed below it until the next rebuild. The embed now goes just above Reflections (0343's
// insertBeforeReflectionsSteps), where the rebuild also puts it.
import { insertBeforeReflectionsSteps } from "./0343-a-check-in-appears-the-moment-it-is-picked.mjs";

export const id = "0441-check-in-under-the-wheel";
export const describe = "Mood: Record Selection embeds a new Check In just above the day's Reflections section (under the Emotions Wheel) instead of at the end of the column.";
export const touches = ["operations"];

/** The pipeline with 0343's embed step's body replaced. Pure. */
export function placeUnderWheel(pipeline) {
  let found = 0;
  const walk = (steps) => (steps || []).map((s) => {
    if (s?.id === "embedNewCheckIn" && s.type === "if") {
      found++;
      if (JSON.stringify(s.then).includes("embedNewCheckIn-reflFind")) return s;
      return { ...s, then: insertBeforeReflectionsSteps() };
    }
    if (s?.type === "if") return { ...s, then: walk(s.then), else: walk(s.else) };
    if (s?.type === "loop") return { ...s, body: walk(s.body) };
    return s;
  });
  const steps = walk(pipeline?.steps);
  if (found !== 1) throw new Error(`0441: expected 0343's embed step once, found ${found}`);
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();
  if (!op) throw new Error("no Mood: Record Selection");
  const next = placeUnderWheel(op.pipeline);
  const changed = JSON.stringify(next) !== JSON.stringify(op.pipeline);
  log(`  ${changed ? "embed goes above Reflections" : "already there"}`);
  if (dryRun || !changed) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: next, updatedAt: new Date() } });
  log("  applied. RESTART pm2.");
}
