import { describe, it, expect } from "vitest";
import { emptySelection, cycleDay, seedSelection, barPosition } from "../ui/daySelectionCycle";

// Helper: run a sequence of day-clicks from empty and return the final state.
function run(...days) {
  let s = emptySelection();
  for (const d of days) s = cycleDay(s, d);
  return s;
}
const D = (n) => `2026-05-${String(n).padStart(2, "0")}`;
const ranged = (s) => s.keys.filter((k) => s.kind[k] === "range").sort();
const distinct = (s) => s.keys.filter((k) => s.kind[k] === "distinct").sort();

describe("daySelectionCycle — on/link/off", () => {
  it("1st click on a fresh day → distinct", () => {
    const s = run(D(6));
    expect(s.keys).toEqual([D(6)]);
    expect(s.kind[D(6)]).toBe("distinct");
  });

  it("clicking a different day adds another distinct day (no auto-range)", () => {
    const s = run(D(6), D(9));
    expect(distinct(s)).toEqual([D(6), D(9)]);
    expect(ranged(s)).toEqual([]);
  });

  it("lone distinct day clicked again → off (no neighbor to link to)", () => {
    const s = run(D(6), D(6));
    expect(s.keys).toEqual([]);
  });

  it("2nd click on a distinct day with a neighbor → fills the range", () => {
    const s = run(D(6), D(9), D(9)); // 6 distinct, 9 distinct, then link 9
    expect(s.keys).toEqual([D(6), D(7), D(8), D(9)]);
    expect(ranged(s)).toEqual([D(6), D(7), D(8), D(9)]);
  });

  it("link fills toward BOTH neighbors (5,9,20 → click 9 → 5–20)", () => {
    const s0 = run(D(5), D(9), D(20)); // three distinct
    const s = cycleDay(s0, D(9));
    expect(s.keys[0]).toBe(D(5));
    expect(s.keys[s.keys.length - 1]).toBe(D(20));
    expect(s.keys).toHaveLength(16);
    expect(ranged(s)).toHaveLength(16);
  });

  it("punch hole: clicking an interior range day splits the bar, pieces stay", () => {
    const bar = run(D(6), D(9), D(9)); // range 6–9
    const s = cycleDay(bar, D(8));
    expect(s.keys).toEqual([D(6), D(7), D(9)]);
    expect(ranged(s)).toEqual([D(6), D(7)]); // 6–7 stays a bar
    expect(distinct(s)).toEqual([D(9)]); // lone remnant demoted to distinct
  });

  it("trim: clicking the END of a range removes just that day", () => {
    const bar = run(D(6), D(9), D(9)); // range 6–9
    const s = cycleDay(bar, D(9));
    expect(s.keys).toEqual([D(6), D(7), D(8)]);
    expect(ranged(s)).toEqual([D(6), D(7), D(8)]);
  });

  it("a fresh click next to a bar stays a distinct day (no merge)", () => {
    const bar = run(D(6), D(9), D(9)); // range 6–9
    const s = cycleDay(bar, D(10));
    expect(ranged(s)).toEqual([D(6), D(7), D(8), D(9)]);
    expect(distinct(s)).toEqual([D(10)]);
  });

  it("re-seal: clicking a lone remnant links it back into the bar", () => {
    const bar = run(D(6), D(9), D(9)); // range 6–9
    const split = cycleDay(bar, D(8)); // [6–7] + lone 9
    const resealed = cycleDay(split, D(9)); // 9 is distinct → links to 7
    expect(resealed.keys).toEqual([D(6), D(7), D(8), D(9)]);
    expect(ranged(resealed)).toEqual([D(6), D(7), D(8), D(9)]);
  });

  it("a 2-day bar trimmed to 1 demotes the remnant to distinct", () => {
    const bar = run(D(6), D(7), D(7)); // 6 distinct, 7 distinct, link 7 → range 6–7
    expect(ranged(bar)).toEqual([D(6), D(7)]);
    const s = cycleDay(bar, D(7)); // remove 7
    expect(s.keys).toEqual([D(6)]);
    expect(s.kind[D(6)]).toBe("distinct");
  });
});

describe("daySelectionCycle — seed + barPosition", () => {
  it("seedSelection: contiguous runs → range, isolated → distinct", () => {
    const s = seedSelection([D(6), D(9), D(10), D(11), D(20)]);
    expect(s.kind[D(6)]).toBe("distinct");
    expect(s.kind[D(20)]).toBe("distinct");
    expect(s.kind[D(9)]).toBe("range");
    expect(s.kind[D(10)]).toBe("range");
    expect(s.kind[D(11)]).toBe("range");
  });

  it("barPosition reports start/mid/end across a bar", () => {
    const bar = run(D(6), D(9), D(9)); // range 6–9
    expect(barPosition(bar, D(6))).toBe("start");
    expect(barPosition(bar, D(7))).toBe("mid");
    expect(barPosition(bar, D(9))).toBe("end");
    expect(barPosition(bar, D(15))).toBe(null);
  });
});
