import { describe, it, expect } from "vitest";
import { planDanglingSweep } from "../migrations/0266-sweep-dangling-child-refs.mjs";

const occ = (id, kids) => ({ id, occurrences: kids });

describe("planDanglingSweep", () => {
  it("pulls only the ids that resolve to no document", () => {
    const plan = planDanglingSweep({ occurrences: [
      occ("parent", ["alive", "dead1", "alive2", "dead2"]),
      occ("alive", []), occ("alive2", []),
    ]});
    expect(plan).toEqual([{ parentId: "parent", ids: ["dead1", "dead2"], kept: 2 }]);
  });

  it("leaves a parent whose children ALL resolve completely alone", () => {
    // The control. Without it "pull everything" passes the test above.
    const plan = planDanglingSweep({ occurrences: [
      occ("parent", ["a", "b"]), occ("a", []), occ("b", []),
    ]});
    expect(plan).toEqual([]);
  });

  it("never proposes deleting a DOCUMENT — only ids out of arrays", () => {
    // An occurrence that exists but is listed by nobody is a different question
    // (sweepOrphans owns it, and refuses to delete anything holding content).
    const plan = planDanglingSweep({ occurrences: [occ("parent", []), occ("lonely", [])] });
    expect(plan).toEqual([]);
  });

  it("reports the surviving count so a sweep that would empty a parent is visible", () => {
    const plan = planDanglingSweep({ occurrences: [occ("parent", ["dead"])] });
    expect(plan[0].kept).toBe(0);
  });

  it("handles a parent with no occurrences array", () => {
    expect(planDanglingSweep({ occurrences: [{ id: "p" }] })).toEqual([]);
  });

  it("finds refs across SEVERAL parents", () => {
    const plan = planDanglingSweep({ occurrences: [
      occ("p1", ["x", "gone1"]), occ("p2", ["gone2"]), occ("x", []),
    ]});
    expect(plan).toHaveLength(2);
    expect(plan.flatMap((p) => p.ids).sort()).toEqual(["gone1", "gone2"]);
  });
});
