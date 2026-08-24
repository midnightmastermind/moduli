// 0217's one decision: bump a cascade width, but never over a hand-tuned value.
import { describe, it, expect } from "vitest";
import { planWidthBump, OLD_WIDTH, NEW_WIDTH } from "../migrations/0217-tracker-tiles-fill-their-row.mjs";

const occ = (lc) => ({ id: "o", meta: lc ? { layoutCascade: lc } : {} });

describe("planWidthBump", () => {
  it("bumps the old value", () => {
    expect(planWidthBump(occ({ mode: "wrap", childMinWidth: OLD_WIDTH })).childMinWidth).toBe(NEW_WIDTH);
  });

  it("KEEPS every other cascade key", () => {
    // The cascade carries mode, gaps and heights; writing it whole from a
    // partial object is how a sibling key gets dropped.
    const next = planWidthBump(occ({ mode: "wrap", childMinWidth: OLD_WIDTH, childMaxHeight: 200 }));
    expect(next.mode).toBe("wrap");
    expect(next.childMaxHeight).toBe(200);
  });

  it("LEAVES a hand-tuned width alone", () => {
    // The Layout menu edits this key, so a container someone has already set
    // must keep its own number — "every X" is how a deliberate choice is lost.
    expect(planWidthBump(occ({ childMinWidth: 240 }))).toBeNull();
    expect(planWidthBump(occ({ childMinWidth: 160 }))).toBeNull();
  });

  it("is a NO-OP once bumped — a re-run changes nothing", () => {
    expect(planWidthBump(occ({ childMinWidth: NEW_WIDTH }))).toBeNull();
  });

  it("ignores a surface with no cascade at all", () => {
    expect(planWidthBump(occ(null))).toBeNull();
    expect(planWidthBump({})).toBeNull();
    expect(planWidthBump(null)).toBeNull();
  });

  it("does not mutate the original cascade", () => {
    const lc = { childMinWidth: OLD_WIDTH };
    planWidthBump({ meta: { layoutCascade: lc } });
    expect(lc.childMinWidth).toBe(OLD_WIDTH);
  });
});
