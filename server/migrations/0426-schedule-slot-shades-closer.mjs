// 0426 — the two shades of each Schedule slot colour sit close together.
//
// User 2026-10-23: "the 2 shades red and green for the timeslots in schedule are too diff. we need them just a
// bit off, not one dark and one super light." `Schedule: Mark Passed Slots` alternated passed slots between red
// 0.10 and 0.20 and idle slots between grey 0.22 and 0.12 — one shade twice the other (and the Terminal skin
// multiplies a wash by 2.2, widening it further). Each pair now differs by 0.04: 0.20 / 0.16.
//
// The colours appear both as the UPDATE value and in the IS_NOT guard beside it, so every occurrence of each
// old literal in the pipeline is rewritten (a guard left on the old value would repaint the slot every run).
// Pipeline only; the op repaints the slots on its next run (every 5 minutes, or on load).
import { PASSED_A as OLD_PASSED_A, PASSED_B as OLD_PASSED_B, IDLE_A as OLD_IDLE_A, IDLE_B as OLD_IDLE_B } from "./0349-schedule-slots-alternate-shades.mjs";

export const id = "0426-schedule-slot-shades-closer";
export const describe = "Schedule: Mark Passed Slots — each slot colour's two shades are close (red 0.20/0.16, grey 0.20/0.16). Pipeline only.";
export const touches = ["operations"];
const OP_NAME = "Schedule: Mark Passed Slots";

export const PASSED_A = "rgba(248,113,113,0.16)";
export const PASSED_B = "rgba(248,113,113,0.20)";
export const IDLE_A = "rgba(148,163,184,0.20)";
export const IDLE_B = "rgba(148,163,184,0.16)";

// A colour that keeps its value (red 0.20) is not a swap — counting it would report a change on every run.
const SWAP = new Map([
  [OLD_PASSED_A, PASSED_A], [OLD_PASSED_B, PASSED_B], [OLD_IDLE_A, IDLE_A], [OLD_IDLE_B, IDLE_B],
].filter(([from, to]) => from !== to));

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
export function closeSlotShades(pipeline) {
  const counter = { n: 0 };
  const p = rewrite(pipeline, counter);
  return { pipeline: p, changed: counter.n > 0, count: counter.n };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" op — nothing to do.`); return; }
  const { pipeline, changed, count } = closeSlotShades(op.pipeline);
  if (!changed) { log("unchanged: no old shade values in the pipeline."); return; }
  log(`${OP_NAME}: ${count} colour literal(s) -> passed ${PASSED_A} / ${PASSED_B}, idle ${IDLE_A} / ${IDLE_B}.`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  const s = JSON.stringify(after.pipeline);
  if (closeSlotShades(after.pipeline).changed || ![PASSED_A, PASSED_B, IDLE_A, IDLE_B].every((v) => s.includes(v))) {
    throw new Error("readback: slot shades not rewritten");
  }
  log("applied and read back.");
}
