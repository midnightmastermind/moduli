import { describe, it, expect } from "vitest";
import { stripeSlotPaint, PASSED_A as OLD_PA, PASSED_B as OLD_PB, IDLE_B as OLD_IB, IDLE_A as OLD_IA } from "../migrations/0349-schedule-slots-alternate-shades.mjs";
import { closeSlotShades, PASSED_A, PASSED_B, IDLE_A, IDLE_B } from "../migrations/0426-schedule-slot-shades-closer.mjs";

const alpha = (c) => Number(c.match(/,([\d.]+)\)$/)[1]);
const guarded = (v) => ({ type: "if", condition: { rules: [{ left: "$slot.ownStyle.bg", comparator: "IS_NOT", right: v }] },
  then: [{ type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: v } }], else: [] });

describe("0426 slot shades closer", () => {
  it("each pair differs by at most 0.05 of alpha", () => {
    expect(Math.abs(alpha(PASSED_A) - alpha(PASSED_B))).toBeLessThanOrEqual(0.05);
    expect(Math.abs(alpha(IDLE_A) - alpha(IDLE_B))).toBeLessThanOrEqual(0.05);
  });
  it("the old pairs were the far-apart ones (control)", () => {
    expect(Math.abs(alpha(OLD_PA) - alpha(OLD_PB))).toBeGreaterThan(0.05);
    expect(Math.abs(alpha(OLD_IA) - alpha(OLD_IB))).toBeGreaterThan(0.05);
  });
  it("rewrites the UPDATE value AND its IS_NOT guard together", () => {
    const p = { steps: [guarded(OLD_PA), guarded(OLD_PB), guarded(OLD_IA), guarded(OLD_IB), guarded("rgba(74,222,128,0.16)")] };
    const { pipeline, changed, count } = closeSlotShades(p);
    expect(changed).toBe(true);
    expect(count).toBe(6); // red 0.20 keeps its value
    const s = JSON.stringify(pipeline);
    for (const old of [OLD_PA, OLD_IA, OLD_IB]) expect(s).not.toContain(old);
    for (const v of [PASSED_A, PASSED_B, IDLE_A, IDLE_B]) expect(s).toContain(v);
    expect(pipeline.steps[0].condition.rules[0].right).toBe(pipeline.steps[0].then[0].config.value);
    expect(pipeline.steps[4].then[0].config.value).toBe("rgba(74,222,128,0.16)"); // current-slot green untouched
  });
  it("is idempotent", () => {
    const once = closeSlotShades({ steps: [guarded(OLD_PA), guarded(OLD_PB), guarded(OLD_IA), guarded(OLD_IB)] }).pipeline;
    expect(closeSlotShades(once).changed).toBe(false);
  });
  it("is exported for the seed (stripeSlotPaint output carries the old literals)", () => {
    expect(typeof stripeSlotPaint).toBe("function");
  });
});
