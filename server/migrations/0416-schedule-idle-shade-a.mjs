// 0416 — the idle stripe's SECOND shade gets a grey; 0414's change is undone.
//
// User 2026-10-17: "you adjusted the wrong gray element. it should be the other one (it
// switches off between shades), adjust the other one back". The idle stripe alternates
// shade A / shade B. 0414 strengthened B (0.12 -> 0.22); the faint one was A, which was
// CLEARED, so every other slot not yet past showed no grey at all. This puts B back to
// 0.12 and paints A with its own grey (0349's IDLE_A).
import { IDLE_A, IDLE_B } from "./0349-schedule-slots-alternate-shades.mjs";

export const id = "0416-schedule-idle-shade-a";
export const describe = "Mark Passed Slots: idle shade A painted grey (was cleared); shade B back to 0.12. Pipeline only.";
export const touches = ["operations"];
const OP_NAME = "Schedule: Mark Passed Slots";
const B_0414 = "rgba(148,163,184,0.22)";
const BG = "$slot.ownStyle.bg";

const walkSteps = function* (steps) {
  if (!Array.isArray(steps)) return;
  for (const s of steps) { yield s; yield* walkSteps(s.body); yield* walkSteps(s.then); yield* walkSteps(s.else); }
};

/** Pure: `{ pipeline, changed, reason }`. */
export function paintIdleShadeA(pipeline) {
  const p = structuredClone(pipeline);
  let changed = false;
  // 1. 0414's B back to 0.12 (guard + paint).
  const fix = (v) => (v === B_0414 ? (changed = true, IDLE_B) : v);
  for (const s of walkSteps(p.steps)) {
    if (s.config?.value !== undefined) s.config.value = fix(s.config.value);
    for (const r of s.condition?.rules || []) r.right = fix(r.right);
  }
  // 2. Shade A: the THEN branch of the idle stripe, the dedup'd clear (`bg IS_NOT ""` -> `bg = ""`).
  const idle = [...walkSteps(p.steps)].find((s) => s.id === "slotStripe-idle");
  if (!idle) return { pipeline: p, changed, reason: "no idle stripe" };
  const a = idle.then?.[0];
  const upd = a?.then?.[0];
  // Either 0349's cleared shape, or a shade A already painted (`slotStripe-idleA`, seen
  // on poms grid with a value of its own) — both end up painting IDLE_A.
  const isShadeA = a?.type === "if" && upd?.config?.path === BG && (upd.config.value === "" || a.id === "slotStripe-idleA");
  if (isShadeA && upd.config.value !== IDLE_A) {
    const was = upd.config.value;
    upd.config.value = IDLE_A;
    for (const r of a.condition?.rules || []) if (r.left === BG && r.right === was) r.right = IDLE_A;
    changed = true;
  }
  return { pipeline: p, changed, reason: changed ? null : "already painted" };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" op — nothing to do.`); return; }
  const { pipeline, changed, reason } = paintIdleShadeA(op.pipeline);
  if (!changed) { log(`unchanged: ${reason}.`); return; }
  log(`${OP_NAME}: idle shade A -> ${IDLE_A}, shade B -> ${IDLE_B}.`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  const s = JSON.stringify(after.pipeline);
  if (s.includes(B_0414) || !s.includes(IDLE_A)) throw new Error("readback failed");
  log("applied and read back.");
}
