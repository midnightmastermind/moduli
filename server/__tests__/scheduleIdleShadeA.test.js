import { describe, it, expect } from "vitest";
import { paintIdleShadeA } from "../migrations/0416-schedule-idle-shade-a.mjs";
import { stripeSlotPaint, IDLE_A, IDLE_B, PASSED_A } from "../migrations/0349-schedule-slots-alternate-shades.mjs";

// A stored op as 0349 + 0414 left it: shade A cleared, shade B at 0.22.
const clearPaint = { type: "if", condition: { rules: [{ left: "$slot.ownStyle.bg", comparator: "IS_NOT", right: "" }] },
  then: [{ type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: "" } }], else: [] };
const bPaint = { type: "if", condition: { rules: [{ left: "$slot.ownStyle.bg", comparator: "IS_NOT", right: "rgba(148,163,184,0.22)" }] },
  then: [{ type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: "rgba(148,163,184,0.22)" } }], else: [] };
const passed = { type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: PASSED_A } };
const stored = () => ({ steps: [{ id: "slotStripe-idle", type: "if", then: [structuredClone(clearPaint)], else: [structuredClone(bPaint)] }, structuredClone(passed)] });

describe("0416 paintIdleShadeA", () => {
  it("paints shade A grey and puts shade B back to 0.12; leaves red alone", () => {
    const { pipeline, changed } = paintIdleShadeA(stored());
    expect(changed).toBe(true);
    const [idle, red] = pipeline.steps;
    expect(idle.then[0].then[0].config.value).toBe(IDLE_A);
    expect(idle.then[0].condition.rules[0].right).toBe(IDLE_A);
    expect(idle.else[0].then[0].config.value).toBe(IDLE_B);
    expect(idle.else[0].condition.rules[0].right).toBe(IDLE_B);
    expect(red.config.value).toBe(PASSED_A);
  });
  it("a shade A that is already painted (any value) is repainted with IDLE_A", () => {
    const st = stored();
    st.steps[0].then[0] = { id: "slotStripe-idleA", type: "if", condition: { rules: [{ left: "$slot.ownStyle.bg", comparator: "IS_NOT", right: IDLE_B }] },
      then: [{ type: "action", config: { type: "UPDATE", path: "$slot.ownStyle.bg", value: IDLE_B } }], else: [] };
    const { pipeline } = paintIdleShadeA(st);
    expect(pipeline.steps[0].then[0].then[0].config.value).toBe(IDLE_A);
    expect(pipeline.steps[0].then[0].condition.rules[0].right).toBe(IDLE_A);
  });
  it("is a no-op the second time", () => {
    expect(paintIdleShadeA(paintIdleShadeA(stored()).pipeline).changed).toBe(false);
  });
  it("both idle shades are a visible grey and still a wash", () => {
    const a = (c) => Number(/,\s*([\d.]+)\)$/.exec(c)[1]);
    expect(a(IDLE_A)).toBeGreaterThan(0.12);
    expect(a(IDLE_A)).toBeLessThanOrEqual(0.35);
    expect(IDLE_B).toBe("rgba(148,163,184,0.12)");
  });
});
