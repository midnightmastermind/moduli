// 0414 — the grey stripe on Schedule slots not yet past is stronger.
//
// User 2026-10-17: the grey (idle) stripe that `Schedule: Mark Passed Slots` paints on
// every other slot not yet reached did not show. It was rgba(148,163,184,0.12); it is
// 0.22 now (0349's IDLE_B — what a fresh seed paints). Still under WASH_ALPHA_MAX, so
// every skin keeps it a tint. This rewrites the stored op; the op repaints the slots on
// its next run (every 5 minutes, and on load).
import { IDLE_B, IDLE_B_OLD } from "./0349-schedule-slots-alternate-shades.mjs";

export const id = "0414-schedule-idle-stripe-stronger";
export const describe = "Schedule: Mark Passed Slots paints the idle grey stripe at 0.22 instead of 0.12. Pipeline only.";
export const touches = ["operations"];
const OP_NAME = "Schedule: Mark Passed Slots";

/** Pure: every place the pipeline names the old grey names the new one. */
export function strengthenIdle(pipeline) {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x); return o; }
    if (v === IDLE_B_OLD) { n++; return IDLE_B; }
    return v;
  };
  return { pipeline: walk(pipeline), replaced: n };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" op — nothing to do.`); return; }
  const { pipeline, replaced } = strengthenIdle(op.pipeline);
  if (!replaced) { log("unchanged: the old grey is not in the pipeline."); return; }
  log(`${OP_NAME}: ${replaced} place(s) ${IDLE_B_OLD} -> ${IDLE_B}.`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  if (strengthenIdle(after.pipeline).replaced) throw new Error("readback: old grey still present");
  log("applied and read back.");
}
