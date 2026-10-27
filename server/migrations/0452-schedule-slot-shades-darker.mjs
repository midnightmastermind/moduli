// 0452 — the Schedule's slot colours are darker (user, 2026-10-27: "the background colors for the timeslots can be
// darker").
//
// `Schedule: Mark Passed Slots` paints each slot: green for the current one, red for passed ones and grey for
// upcoming ones (two close shades alternating, 0426). Each keeps its hue but takes a much deeper base colour, a
// little stronger so it still shows (0.20 / 0.24, inside StyleHelpers' 0.24 surface cap):
//   current  rgba(74,222,128,.16)          -> rgba(22,101,52,.24)
//   passed   rgba(248,113,113,.16 / .20)   -> rgba(153,27,27,.20 / .24)
//   upcoming rgba(148,163,184,.20 / .16)   -> rgba(51,65,85,.24 / .20)
// Every occurrence of each old literal is rewritten (the IS_NOT guard beside each UPDATE carries it too, or the op
// would repaint every slot on every run). Pipeline only; the op repaints the slots on its next run.
import { PASSED_A as OLD_PASSED_A, PASSED_B as OLD_PASSED_B, IDLE_A as OLD_IDLE_A, IDLE_B as OLD_IDLE_B } from "./0426-schedule-slot-shades-closer.mjs";

export const id = "0452-schedule-slot-shades-darker";
export const describe = "Schedule: Mark Passed Slots — darker slot colours (deep green / red / slate). Pipeline only.";
export const touches = ["operations"];
const OP_NAME = "Schedule: Mark Passed Slots";

export const OLD_CURRENT = "rgba(74,222,128,0.16)";
export const CURRENT = "rgba(22,101,52,0.24)";
export const PASSED_A = "rgba(153,27,27,0.20)";
export const PASSED_B = "rgba(153,27,27,0.24)";
export const IDLE_A = "rgba(51,65,85,0.24)";
export const IDLE_B = "rgba(51,65,85,0.20)";

const SWAP = new Map([
  [OLD_CURRENT, CURRENT], [OLD_PASSED_A, PASSED_A], [OLD_PASSED_B, PASSED_B], [OLD_IDLE_A, IDLE_A], [OLD_IDLE_B, IDLE_B],
]);

function rewrite(node, counter) {
  if (typeof node === "string") {
    if (SWAP.has(node)) { counter.n++; return SWAP.get(node); }
    return node;
  }
  if (Array.isArray(node)) return node.map((x) => rewrite(x, counter));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = rewrite(v, counter);
    return out;
  }
  return node;
}

/** Pure: `{ pipeline, changed, count }`. Idempotent (the new values are not keys of SWAP). */
export function darkenSlotShades(pipeline) {
  const counter = { n: 0 };
  const p = rewrite(pipeline, counter);
  return { pipeline: p, changed: counter.n > 0, count: counter.n };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" op — nothing to do.`); return; }
  const { pipeline, changed, count } = darkenSlotShades(op.pipeline);
  if (!changed) { log("unchanged: no old shade values in the pipeline."); return; }
  log(`${OP_NAME}: ${count} colour literal(s) -> current ${CURRENT}, passed ${PASSED_A} / ${PASSED_B}, upcoming ${IDLE_A} / ${IDLE_B}.`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  const s = JSON.stringify(after.pipeline);
  if (darkenSlotShades(after.pipeline).changed || ![CURRENT, PASSED_A, PASSED_B, IDLE_A, IDLE_B].every((v) => s.includes(v))) {
    throw new Error("read-back: the pipeline does not hold the new shades");
  }
  log("applied and read back. RESTART pm2 (the warm cache holds the old pipeline).");
}
