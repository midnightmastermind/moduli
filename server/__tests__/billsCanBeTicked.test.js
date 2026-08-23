// 0208's one decision: append a binding, never duplicate or reorder one.
import { describe, it, expect } from "vitest";
import { planBindingAppend } from "../migrations/0208-bills-can-be-ticked.mjs";

const C = "fCompleted";

describe("planBindingAppend", () => {
  it("appends AFTER the existing bindings, with the next order", () => {
    // Binding order is render order — inserting would reorder seven pills on
    // eleven live rows to gain one checkbox.
    const next = planBindingAppend([{ fieldId: "a", order: 0 }, { fieldId: "b", order: 1 }], C);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ fieldId: C, order: 2, role: "input", hidden: false });
    expect(next[0].fieldId).toBe("a");
  });

  it("is a NO-OP when the field is already bound — a re-run must not duplicate", () => {
    expect(planBindingAppend([{ fieldId: C, order: 0 }], C)).toBeNull();
  });

  it("binds it VISIBLE and as an input — a hidden checkbox cannot be ticked", () => {
    const next = planBindingAppend([], C);
    expect(next[0].hidden).toBe(false);
    expect(next[0].role).toBe("input");
  });

  it("handles a module with no bindings at all", () => {
    expect(planBindingAppend([], C)).toEqual([{ fieldId: C, order: 0, role: "input", hidden: false }]);
    expect(planBindingAppend(undefined, C)).toHaveLength(1);
  });

  it("survives a binding carrying no order", () => {
    const next = planBindingAppend([{ fieldId: "a" }], C);
    expect(next[1].order).toBe(1);
  });

  it("does not mutate the original array", () => {
    const orig = [{ fieldId: "a", order: 0 }];
    planBindingAppend(orig, C);
    expect(orig).toHaveLength(1);
  });
});
