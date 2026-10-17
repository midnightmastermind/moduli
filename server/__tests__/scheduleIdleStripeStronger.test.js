import { describe, it, expect } from "vitest";
import { strengthenIdle } from "../migrations/0414-schedule-idle-stripe-stronger.mjs";
import { IDLE_B, IDLE_B_OLD, PASSED_A } from "../migrations/0349-schedule-slots-alternate-shades.mjs";

describe("0414 strengthenIdle", () => {
  const pipe = { steps: [{ type: "if", condition: { rules: [{ right: IDLE_B_OLD }] },
    then: [{ type: "action", config: { type: "UPDATE", value: IDLE_B_OLD } }],
    else: [{ type: "action", config: { type: "UPDATE", value: PASSED_A } }] }] };
  it("rewrites the guard and the paint, and nothing else", () => {
    const { pipeline, replaced } = strengthenIdle(pipe);
    expect(replaced).toBe(2);
    expect(pipeline.steps[0].condition.rules[0].right).toBe(IDLE_B);
    expect(pipeline.steps[0].then[0].config.value).toBe(IDLE_B);
    expect(pipeline.steps[0].else[0].config.value).toBe(PASSED_A);
  });
  it("is a no-op on a pipeline already rewritten", () => {
    expect(strengthenIdle(strengthenIdle(pipe).pipeline).replaced).toBe(0);
  });
  it("the new grey is stronger and still a wash", () => {
    const a = (c) => Number(/,\s*([\d.]+)\)$/.exec(c)[1]);
    expect(a(IDLE_B)).toBeGreaterThan(a(IDLE_B_OLD));
    expect(a(IDLE_B)).toBeLessThanOrEqual(0.35);
  });
});
