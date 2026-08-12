// 0081 exists because LISTING a child is not the same as giving it a PATH:
// `buildParentMap` keys child -> ONE parent (last writer wins), so a child with
// two parents gets an arbitrary one. `canReach` asks the different question —
// does a path exist AT ALL — and that difference is the whole migration.
import { describe, it, expect } from "vitest";
import { canReach } from "../migrations/0081-resolved-journals-need-one-path.mjs";

// parents: { child: [parent, ...] }
const P = (parents) => (id) => parents[id] || [];

describe("0081 canReach", () => {
  it("finds a path through the SECOND parent, which a single-parent map would miss", () => {
    // The defect in one case: buildParentMap might pick "dead", and walking only
    // that one reports unreachable even though "sched" is right there.
    const parents = { journal: ["dead", "sched"], dead: ["nowhere"] };
    expect(canReach("journal", "sched", P(parents))).toBe(true);
  });

  it("reports UNREACHABLE when every path dead-ends", () => {
    const parents = { journal: ["dead"], dead: ["nowhere"] };
    expect(canReach("journal", "sched", P(parents))).toBe(false);
  });

  it("finds a path several levels up", () => {
    const parents = { journal: ["slot"], slot: ["daycol"], daycol: ["sched"] };
    expect(canReach("journal", "sched", P(parents))).toBe(true);
  });

  it("terminates on a cycle instead of hanging", () => {
    const parents = { a: ["b"], b: ["a"] };
    expect(canReach("a", "sched", P(parents))).toBe(false);
  });

  it("respects the depth cap rather than walking forever", () => {
    const parents = {};
    for (let i = 0; i < 100; i++) parents[`n${i}`] = [`n${i + 1}`];
    parents.n99 = ["sched"];
    expect(canReach("n0", "sched", P(parents), 5)).toBe(false);
    expect(canReach("n0", "sched", P(parents), 200)).toBe(true);
  });

  it("an occurrence trivially reaches itself", () => {
    expect(canReach("sched", "sched", P({}))).toBe(true);
  });
});
