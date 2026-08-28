import { describe, it, expect } from "vitest";
import {
  bindingOrderOf,
  compareBindingOrder,
  sortBindingsForDisplay,
  moveBinding,
} from "../helpers/fieldBindingOrder";
import { resolveOccurrenceFields } from "../helpers/autoAppliedFields";

const b = (fieldId, order) => (order === undefined ? { fieldId } : { fieldId, order });
const ids = (list) => list.map((x) => x.fieldId);

describe("bindingOrderOf / compareBindingOrder", () => {
  it("treats a missing order as 0 — an unordered binding sorts to the FRONT", () => {
    expect(bindingOrderOf({ fieldId: "a" })).toBe(0);
    expect(bindingOrderOf(undefined)).toBe(0);
    expect(compareBindingOrder({ order: 3 }, { fieldId: "x" })).toBeGreaterThan(0);
  });
});

describe("sortBindingsForDisplay", () => {
  it("orders by `order`, which is what the occurrence renders by", () => {
    expect(ids(sortBindingsForDisplay([b("c", 2), b("a", 0), b("b", 1)]))).toEqual(["a", "b", "c"]);
  });

  it("breaks ties by array position — the renderer's own tiebreak (287 modules on the live grid)", () => {
    expect(ids(sortBindingsForDisplay([b("x", 1), b("y", 1), b("z", 1)]))).toEqual(["x", "y", "z"]);
  });

  it("does not mutate the caller's array", () => {
    const input = [b("c", 2), b("a", 0)];
    sortBindingsForDisplay(input);
    expect(ids(input)).toEqual(["c", "a"]);
  });

  it("tolerates a non-array", () => {
    expect(sortBindingsForDisplay(null)).toEqual([]);
    expect(sortBindingsForDisplay(undefined)).toEqual([]);
  });

  it("AGREES WITH THE RENDERER — the same list, sorted by the shared comparator", () => {
    // The editor list and the rendered row must not disagree; that mismatch is
    // the defect this feature had to fix before arrows could work at all.
    // The ids are deliberately in the OPPOSITE order to the render order, so a
    // resolver that sorted by anything else (id, array position) fails this.
    const bindings = [b("z", 0), b("a", 3), b("m", 1), b("d", 3)];
    const fieldsById = { a: { id: "a" }, d: { id: "d" }, m: { id: "m" }, z: { id: "z" } };
    const rendered = resolveOccurrenceFields({
      module: { role: "instance", fieldBindings: bindings },
      fieldsById,
    }).map((e) => e.binding.fieldId);
    expect(rendered).toEqual(["z", "m", "a", "d"]);          // by order, ties by array position
    expect(ids(sortBindingsForDisplay(bindings))).toEqual(rendered);
  });
});

describe("moveBinding", () => {
  const three = [b("a", 0), b("b", 1), b("c", 2)];

  it("moves a field DOWN one place and renumbers 0..n-1", () => {
    const next = moveBinding(three, "a", 1);
    expect(ids(next)).toEqual(["b", "a", "c"]);
    expect(next.map((x) => x.order)).toEqual([0, 1, 2]);
  });

  it("moves a field UP one place", () => {
    expect(ids(moveBinding(three, "c", -1))).toEqual(["a", "c", "b"]);
  });

  it("returns null at the top edge, so a disabled press mints no transaction", () => {
    expect(moveBinding(three, "a", -1)).toBeNull();
  });

  it("returns null at the bottom edge", () => {
    expect(moveBinding(three, "c", 1)).toBeNull();
  });

  it("returns null for an unknown field, a single binding, and a zero delta", () => {
    expect(moveBinding(three, "nope", 1)).toBeNull();
    expect(moveBinding([b("a", 0)], "a", 1)).toBeNull();
    expect(moveBinding(three, "a", 0)).toBeNull();
  });

  it("operates on DISPLAY order, not array order — the case a naive swap gets wrong", () => {
    // Array order [c,a,b] but renders a,b,c. Moving "b" up must put it above
    // "a" (its display neighbour), not above "c" (its array neighbour).
    const scrambled = [b("c", 2), b("a", 0), b("b", 1)];
    expect(ids(moveBinding(scrambled, "b", -1))).toEqual(["b", "a", "c"]);
  });

  it("RENUMBERS AWAY DUPLICATE ORDERS — a swap would move the row an unpredictable distance", () => {
    const tied = [b("x", 1), b("y", 1), b("z", 1)];
    const next = moveBinding(tied, "z", -1);
    expect(ids(next)).toEqual(["x", "z", "y"]);
    expect(next.map((n) => n.order)).toEqual([0, 1, 2]);
  });

  it("RENUMBERS AWAY GAPS — Field.jsx writes order 99 for a poster binding", () => {
    const gappy = [b("a", 0), b("b", 1), b("poster", 99)];
    const next = moveBinding(gappy, "poster", -1);
    expect(ids(next)).toEqual(["a", "poster", "b"]);
    expect(next.map((n) => n.order)).toEqual([0, 1, 2]);
  });

  it("handles bindings that carry NO order at all (80 modules on the live grid)", () => {
    const none = [{ fieldId: "a" }, { fieldId: "b" }, { fieldId: "c" }];
    const next = moveBinding(none, "c", -1);
    expect(ids(next)).toEqual(["a", "c", "b"]);
    expect(next.map((n) => n.order)).toEqual([0, 1, 2]);
  });

  it("preserves every other key on the binding it moves", () => {
    const rich = [
      { fieldId: "a", order: 0, role: "media", hidden: true, link: "date" },
      { fieldId: "b", order: 1 },
    ];
    const moved = moveBinding(rich, "a", 1).find((x) => x.fieldId === "a");
    expect(moved).toEqual({ fieldId: "a", order: 1, role: "media", hidden: true, link: "date" });
  });

  it("does not mutate the caller's array", () => {
    const input = [b("a", 0), b("b", 1)];
    moveBinding(input, "a", 1);
    expect(ids(input)).toEqual(["a", "b"]);
    expect(input[0].order).toBe(0);
  });

  it("a move then its inverse returns the original display order", () => {
    const down = moveBinding(three, "a", 1);
    expect(ids(moveBinding(down, "a", -1))).toEqual(["a", "b", "c"]);
  });
});
