import { describe, it, expect } from "vitest";
import { darkenSlotShades, CURRENT, PASSED_A, PASSED_B, IDLE_A, IDLE_B } from "../migrations/0452-schedule-slot-shades-darker.mjs";

const pipe = { steps: [
  { type: "if", rule: { right: "rgba(74,222,128,0.16)", op: "IS_NOT" }, then: [{ config: { type: "UPDATE", value: "rgba(74,222,128,0.16)" } }] },
  { config: { value: "rgba(248,113,113,0.16)" } }, { config: { value: "rgba(248,113,113,0.20)" } },
  { config: { value: "rgba(148,163,184,0.20)" } }, { config: { value: "rgba(148,163,184,0.16)" } },
  { config: { value: "rgba(1,2,3,0.5)" } },
] };

describe("0452 darker slot shades", () => {
  it("rewrites every old literal, guards included, and leaves other colours alone", () => {
    const { pipeline, count } = darkenSlotShades(pipe);
    const s = JSON.stringify(pipeline);
    expect(count).toBe(6);
    for (const v of [CURRENT, PASSED_A, PASSED_B, IDLE_A, IDLE_B]) expect(s).toContain(v);
    expect(s).not.toContain("248,113,113"); expect(s).not.toContain("74,222,128"); expect(s).not.toContain("148,163,184");
    expect(s).toContain("rgba(1,2,3,0.5)");
  });
  it("is idempotent", () => {
    expect(darkenSlotShades(darkenSlotShades(pipe).pipeline).changed).toBe(false);
  });
  it("stays inside the 0.24 surface cap, so the colours show as written", () => {
    for (const v of [CURRENT, PASSED_A, PASSED_B, IDLE_A, IDLE_B]) expect(Number(v.match(/,([\d.]+)\)$/)[1])).toBeLessThanOrEqual(0.24);
  });
});
