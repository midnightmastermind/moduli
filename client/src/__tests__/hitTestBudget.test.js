// The touch drag hit-tested every 32ms regardless of what it cost. Measured on
// the user's tablet during a real drag (2026-09-01), same grid, same gesture:
//     Chrome   elementsFromPoint avg 17.8-30.3ms  → 55-95% of the frame budget
//     Firefox  elementsFromPoint avg  0.6ms       → ~2%
// A fixed interval cannot be right for both, and a bigger constant would make
// the fast browser needlessly laggy.
import { describe, it, expect } from "vitest";
import { hitInterval, blendCost, HIT_MIN_MS, HIT_MAX_MS } from "../helpers/hitTestBudget";

describe("hitInterval — derived from what the hit-test actually costs", () => {
  it("leaves a cheap browser at the interval it already had", () => {
    // Firefox measured 0.6ms. Backing that off would be a regression on a
    // browser that had no problem.
    expect(hitInterval(0.6)).toBe(HIT_MIN_MS);
    expect(hitInterval(3)).toBe(HIT_MIN_MS);
  });

  it("backs off on the browser that measured 18-30ms", () => {
    // At a 25% budget: 18ms of work earns ~72ms of spacing, 30ms earns 120ms.
    expect(hitInterval(17.8)).toBe(71);
    expect(hitInterval(30.3)).toBe(121);
  });

  it("never lets the highlight trail the finger, however bad it gets", () => {
    // The 147ms worst case would ask for 588ms, at which point the drop target
    // is visibly wrong rather than merely late.
    expect(hitInterval(147)).toBe(HIT_MAX_MS);
    expect(hitInterval(10000)).toBe(HIT_MAX_MS);
  });

  it("behaves exactly as before when nothing has been measured yet", () => {
    // The first hit-test of a drag has no sample. Guessing high there would
    // make the first crossing feel dead.
    for (const v of [undefined, null, 0, -1, NaN]) expect(hitInterval(v)).toBe(HIT_MIN_MS);
  });
});

describe("blendCost", () => {
  it("weights recent samples so one dense container does not punish the drag", () => {
    expect(blendCost(10, 30)).toBeCloseTo(16, 5);
    expect(blendCost(30, 10)).toBeCloseTo(24, 5);
  });

  it("takes the first sample whole rather than blending it with nothing", () => {
    expect(blendCost(0, 20)).toBe(20);
    expect(blendCost(undefined, 20)).toBe(20);
  });

  it("ignores a garbage sample instead of poisoning the estimate", () => {
    // A negative or NaN duration must not become the interval — that would
    // silently pin the drag at the floor or the ceiling forever.
    expect(blendCost(12, NaN)).toBe(12);
    expect(blendCost(12, -5)).toBe(12);
  });
});
