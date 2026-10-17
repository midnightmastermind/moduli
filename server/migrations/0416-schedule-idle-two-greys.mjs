// 0416 — idle Schedule slots alternate between TWO greys.
//
// User 2026-10-17: the grey on slots not yet past did not show for some of them. Those
// were idle shade A, which `Schedule: Mark Passed Slots` CLEARED (no colour — black in the
// terminal skin), alternating with a grey shade B. 0414 strengthened shade B, which was the
// wrong one ("it should be the other one (it switches off between shades), adjust the
// other one back and fix the other one"). This puts shade B back to 0.12 and paints shade A
// grey (0.22), so idle slots alternate grey / grey like passed slots alternate red / red.
// Pipeline only; the op repaints the slots on its next run (5 minutes, or on load).
import { IDLE_A, IDLE_B } from "./0349-schedule-slots-alternate-shades.mjs";

export const id = "0416-schedule-idle-two-greys";
export const describe = "Schedule: Mark Passed Slots paints idle shade A grey (0.22) and shade B back at 0.12. Pipeline only.";
export const touches = ["operations"];
const OP_NAME = "Schedule: Mark Passed Slots";
const BG = "$slot.ownStyle.bg";

const paint = (key, value) => ({
  id: `slotStripe-${key}`, type: "if",
  condition: { operator: "AND", rules: [{ id: `slotStripe-${key}-r`, left: BG, comparator: "IS_NOT", right: value }] },
  then: [{ id: `slotStripe-${key}-u`, type: "action", config: { type: "UPDATE", path: BG, value } }],
  else: [],
});
const paintValue = (s) => s?.type === "if" && s.then?.[0]?.config?.type === "UPDATE" && s.then[0].config.path === BG ? s.then[0].config.value : undefined;

function findStep(steps, id) {
  for (const s of steps || []) {
    if (s?.id === id) return s;
    const hit = findStep(s?.body, id) || findStep(s?.then, id) || findStep(s?.else, id);
    if (hit) return hit;
  }
  return null;
}

/** Pure: `{ pipeline, changed, reason }`. Idempotent. */
export function greyIdleStripes(pipeline) {
  const p = structuredClone(pipeline);
  const idle = findStep(p.steps, "slotStripe-idle");
  if (!idle || idle.type !== "if") return { pipeline: p, changed: false, reason: "no idle stripe (0349 not applied)" };
  if (paintValue(idle.then?.[0]) === IDLE_A && paintValue(idle.else?.[0]) === IDLE_B) return { pipeline: p, changed: false, reason: "already two greys" };
  idle.then = [paint("idleA", IDLE_A)];
  idle.else = [paint("idleB", IDLE_B)];
  return { pipeline: p, changed: true };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" op — nothing to do.`); return; }
  const before = findStep(op.pipeline?.steps, "slotStripe-idle");
  const { pipeline, changed, reason } = greyIdleStripes(op.pipeline);
  if (!changed) { log(`unchanged: ${reason}.`); return; }
  log(`${OP_NAME}: idle A ${JSON.stringify(paintValue(before.then?.[0]) ?? null)} -> ${IDLE_A}; idle B ${JSON.stringify(paintValue(before.else?.[0]) ?? null)} -> ${IDLE_B}.`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  if (greyIdleStripes(after.pipeline).reason !== "already two greys") throw new Error("readback: idle stripes not two greys");
  log("applied and read back.");
}
