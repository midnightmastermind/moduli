import { describe, it, expect } from "vitest";
import { orderColumn, planColumnMove, dropIndex } from "../helpers/categoryColumnSort";

const col = (...ids) => ids.map((id, i) => ({ id, columnOrder: i }));

describe("category column order", () => {
  it("orders by columnOrder, unordered items after in arrival order", () => {
    const out = orderColumn([{ id: "x" }, { id: "b", columnOrder: 1 }, { id: "y" }, { id: "a", columnOrder: 0 }]);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "x", "y"]);
  });
  it("moves an item up within its column", () => {
    const c = col("a", "b", "c", "d");
    const w = planColumnMove({ column: c, draggedId: "d", index: dropIndex(c, "b", "top") });
    expect(w).toEqual([{ id: "d", columnOrder: 1 }, { id: "b", columnOrder: 2 }, { id: "c", columnOrder: 3 }]);
  });
  it("moves an item down within its column (its own old slot does not count)", () => {
    const c = col("a", "b", "c", "d");
    const w = planColumnMove({ column: c, draggedId: "a", index: dropIndex(c, "c", "bottom") });
    const order = Object.fromEntries(w.map((x) => [x.id, x.columnOrder]));
    expect(order).toEqual({ a: 2, b: 0, c: 1 });
  });
  it("drops into another column at a slot, and at the end when dropped on the column", () => {
    const c = col("p", "q");
    expect(planColumnMove({ column: c, draggedId: "z", index: dropIndex(c, "q", "top") }))
      .toEqual([{ id: "z", columnOrder: 1 }, { id: "q", columnOrder: 2 }]);
    expect(planColumnMove({ column: c, draggedId: "z", index: null })).toEqual([{ id: "z", columnOrder: 2 }]);
  });
  it("always writes the dragged item even when its slot is unchanged (folder may change)", () => {
    const c = col("a", "b");
    expect(planColumnMove({ column: c, draggedId: "a", index: 0 })).toEqual([{ id: "a", columnOrder: 0 }]);
  });
});
