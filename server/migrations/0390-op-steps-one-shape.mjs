// server/migrations/0390-op-steps-one-shape.mjs
//
// Eight poms operations (Moods, Phone Calls, Movies Watched, Books Read, Podcasts
// Listened, Courses Taken, Daily Question Rotator, Mood: Record Selection) were
// stored in the seed's step dialect — `action`/`cfg` and `conjunction` — which the
// executor reads but the operations editor does not: opened in the editor, every
// action showed as a blank default. utils/pipelineShape.normalizeSteps turns them
// into the editor's shape. Every group is AND today, so behaviour is unchanged.

import { normalizeSteps, hasSeedDialect } from "../utils/pipelineShape.js";

export const id = "0390-op-steps-one-shape";
export const describe = "Operations stored in the seed's step dialect (action/cfg, conjunction) are rewritten in the editor's shape.";
export const touches = ["operations"];

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const ops = await Operation.find({ gridId }).lean();
  const hit = ops.filter((o) => hasSeedDialect(o.pipeline?.steps));
  for (const o of hit) log(`"${o.name}"`);
  log(`${hit.length} operation(s) in the seed dialect`);
  if (dryRun) return;
  for (const o of hit) {
    const steps = normalizeSteps(o.pipeline.steps);
    if (hasSeedDialect(steps)) throw new Error(`0390: "${o.name}" still carries the seed dialect after normalizing`);
    await Operation.updateOne({ gridId, id: o.id }, { $set: { "pipeline.steps": steps } });
  }
  log("done. Restart the server (pm2).");
}
