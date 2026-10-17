// 0418 — the idle greys back to 0416's values.
//
// Two sessions fixed the same thing on 2026-10-17: `0416-schedule-idle-two-greys` (shade A
// 0.22, shade B 0.12) and a duplicate (`0416-schedule-idle-shade-a`, since removed) that ran
// after it and set shade A to 0.24. This re-runs 0416's own rewrite so the stored op holds
// its values again. Pipeline only; idempotent.
import { up as twoGreys } from "./0416-schedule-idle-two-greys.mjs";

export const id = "0418-idle-greys-back-to-0416";
export const describe = "Mark Passed Slots: idle shades back to 0416's 0.22 / 0.12 (a duplicate migration had set 0.24).";
export const touches = ["operations"];
export const up = (ctx) => twoGreys(ctx);
