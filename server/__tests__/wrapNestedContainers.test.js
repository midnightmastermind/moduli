import { describe, it, expect } from "vitest";
import { planSubtree, containerReadableShape }
  from "../migrations/0072-wrap-reaches-nested-tracker-containers.mjs";

const WRAP = { mode: "wrap", childMinWidth: 168 };
const mk = (id, role, kids = [], cascade) => ({ id, role, occurrences: kids, meta: cascade ? { layoutCascade: cascade } : {} });
const world = (rows) => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { occById: byId, roleOf: (o) => o?.role, labelOf: (o) => o?.id };
};
const run = (rows, rootId = "page", shape = WRAP) =>
  planSubtree({ rootId, shape, ...world(rows) });

describe("0072 planSubtree", () => {
  it("reaches a NESTED container — the level 0068 missed", () => {
    // Today's Physical (depth 0, already wrapping) holds Today's Workout
    // (depth 1, which got nothing).
    const rows = [
      mk("page", "page", ["physical"]),
      mk("physical", "container", ["workout"], WRAP),
      mk("workout", "container", ["t1"]),
      mk("t1", "instance"),
    ];
    expect(run(rows).map((w) => w.id)).toEqual(["workout"]);
  });

  it("recurses THROUGH a container that already arranges itself", () => {
    // The discriminating case: physical needs no write, but it still holds one
    // that does — an early `continue` would have missed the whole branch.
    const rows = [
      mk("page", "page", ["physical"]),
      mk("physical", "container", ["workout"], WRAP),
      // FULLY arranged, so it needs no write of its own — which is exactly
      // what isolates "did we still walk THROUGH it".
      mk("workout", "container", ["nested"], WRAP),
      mk("nested", "container", []),
    ];
    expect(run(rows).map((w) => w.id)).toEqual(["nested"]);
  });

  it("NEVER overwrites a container's own value", () => {
    const rows = [
      mk("page", "page", ["c"]),
      mk("c", "container", [], { mode: "grid" }),
    ];
    // mode is its own; childMinWidth is still added
    expect(run(rows)[0].next).toEqual({ mode: "grid", childMinWidth: 168 });
  });

  it("is a no-op once everything already has it — the re-run guard", () => {
    const rows = [mk("page", "page", ["c"]), mk("c", "container", [], WRAP)];
    expect(run(rows)).toEqual([]);
  });

  it("skips non-containers — an instance never gets an arrangement", () => {
    const rows = [mk("page", "page", ["t1"]), mk("t1", "instance")];
    expect(run(rows)).toEqual([]);
  });

  it("does nothing for a non-wrap arrangement", () => {
    // The Day Page pushes flex-row, which no container implements.
    const rows = [mk("page", "page", ["c"]), mk("c", "container")];
    expect(run(rows, "page", { mode: "flex-row", childMinWidth: 420 })).toEqual([]);
  });

  it("survives a cycle instead of hanging", () => {
    const rows = [
      mk("page", "page", ["a"]),
      mk("a", "container", ["b"]),
      mk("b", "container", ["a"]),
    ];
    expect(run(rows).map((w) => w.id).sort()).toEqual(["a", "b"]);
  });
});

describe("0072 containerReadableShape", () => {
  it("carries the keys a container reads", () => {
    expect(containerReadableShape({ mode: "wrap", childMinWidth: 168, childGap: 8, childContentDirection: "column" }))
      .toEqual({ mode: "wrap", childMinWidth: 168, childGap: 8, childContentDirection: "column" });
  });
  it("refuses a non-wrap mode", () => {
    expect(containerReadableShape({ mode: "grid", columns: 3 })).toBeNull();
  });
});
