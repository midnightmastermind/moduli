import { describe, it, expect } from "vitest";
import { greyIdleStripes } from "../migrations/0416-schedule-idle-two-greys.mjs";
import { stripeSlotPaint, IDLE_A, IDLE_B, PASSED_A } from "../migrations/0349-schedule-slots-alternate-shades.mjs";

// The smallest pipeline 0349 recognises: a painting slot loop with passed / clear paints.
const BG = "$slot.ownStyle.bg";
const ifPaint = (v) => ({ id: "p" + v, type: "if", condition: { operator: "AND", rules: [{ left: BG, comparator: "IS_NOT", right: v }] },
  then: [{ id: "u" + v, type: "action", config: { type: "UPDATE", path: BG, value: v } }], else: [] });
const base = { steps: [{ id: "L", type: "loop", overExpr: "$dayCol.occurrences", body: [
  { id: "S", type: "if", condition: { rules: [{ right: "slot" }] }, then: [ifPaint(PASSED_A), ifPaint("")], else: [] },
] }] };
const idleOf = (p) => { const s = JSON.stringify(p); return s; };
const findIdle = (steps) => { for (const s of steps || []) { if (s.id === "slotStripe-idle") return s; const h = findIdle(s.body) || findIdle(s.then) || findIdle(s.else); if (h) return h; } return null; };

describe("0416 greyIdleStripes", () => {
  const striped = stripeSlotPaint(base).pipeline;

  it("paints idle shade A grey instead of clearing it, and shade B at 0.12", () => {
    const { pipeline, changed } = greyIdleStripes(striped);
    expect(changed).toBe(true);
    const idle = findIdle(pipeline.steps);
    expect(idle.then[0].then[0].config.value).toBe(IDLE_A);
    expect(idle.else[0].then[0].config.value).toBe(IDLE_B);
    expect(IDLE_B).toBe("rgba(148,163,184,0.12)");
    expect(idleOf(pipeline)).not.toMatch(/"value":""/);
  });

  it("repairs a pipeline 0414 had strengthened (B = 0.22)", () => {
    const s = JSON.parse(JSON.stringify(striped).replaceAll(IDLE_B, "rgba(148,163,184,0.22)"));
    const idle = findIdle(greyIdleStripes(s).pipeline.steps);
    expect(idle.else[0].then[0].config.value).toBe(IDLE_B);
  });

  it("is idempotent and leaves the passed reds alone", () => {
    const once = greyIdleStripes(striped).pipeline;
    expect(greyIdleStripes(once).changed).toBe(false);
    expect(JSON.stringify(once)).toContain(PASSED_A);
  });

  it("refuses a pipeline without 0349's stripe", () => {
    expect(greyIdleStripes(base).changed).toBe(false);
  });
});
