// 0206's two decisions. Both must be idempotent: a bulkWrite over 1,467 rows
// can be interrupted, and a resumed run must not undo the part that landed.
import { describe, it, expect } from "vitest";
import { planFieldMove, planBindingSwap } from "../migrations/0206-bookmarks-out-of-the-date-filter.mjs";

const D = "fDate", S = "fSaved";

describe("planFieldMove", () => {
  it("moves the date out of the filter field", () => {
    const p = planFieldMove({ [D]: { value: "2021-06-02", flow: "in" } }, D, S);
    expect(p.set[S]).toEqual({ value: "2021-06-02", flow: "in" });
    expect(p.unset).toEqual([D]);
  });

  it("is a NO-OP once the date is gone — a resumed run must not thrash", () => {
    expect(planFieldMove({ [S]: { value: "2021-06-02" } }, D, S)).toBeNull();
    expect(planFieldMove({}, D, S)).toBeNull();
    expect(planFieldMove(undefined, D, S)).toBeNull();
  });

  it("treats an empty-string date as nothing to move", () => {
    expect(planFieldMove({ [D]: { value: "" } }, D, S)).toBeNull();
    expect(planFieldMove({ [D]: { value: null } }, D, S)).toBeNull();
  });

  it("NEVER overwrites a Saved the user set by hand — but still clears Date", () => {
    // If both exist, the hand-set one wins; the filter field is cleared either
    // way, because leaving it is what hid the row.
    const p = planFieldMove({ [D]: { value: "2021-06-02" }, [S]: { value: "2024-01-01" } }, D, S);
    expect(p.set[S].value).toBe("2024-01-01");
    expect(p.unset).toEqual([D]);
  });

  it("leaves the row's OTHER fields alone", () => {
    const p = planFieldMove({ [D]: { value: "2021-06-02" }, url: { value: "x" } }, D, S);
    expect(Object.keys(p.set)).toEqual([S]);
    expect(p.unset).toEqual([D]);
  });
});

describe("planBindingSwap", () => {
  it("swaps Date for Saved IN PLACE, keeping order and the rest of the binding", () => {
    // Binding order is render order, so appending instead of replacing would
    // move the date to the end of every one of 1,467 cards.
    const next = planBindingSwap(
      [{ fieldId: "u", order: 0, role: "input" }, { fieldId: D, order: 1, role: "input", hidden: false }], D, S);
    expect(next[1]).toEqual({ fieldId: S, order: 1, role: "input", hidden: false });
    expect(next[0].fieldId).toBe("u");
  });

  it("is a NO-OP when already swapped", () => {
    expect(planBindingSwap([{ fieldId: S }], D, S)).toBeNull();
  });

  it("is a NO-OP when the module never bound Date", () => {
    expect(planBindingSwap([{ fieldId: "u" }], D, S)).toBeNull();
    expect(planBindingSwap([], D, S)).toBeNull();
    expect(planBindingSwap(undefined, D, S)).toBeNull();
  });

  it("does not mutate the original array", () => {
    const orig = [{ fieldId: D, order: 0 }];
    planBindingSwap(orig, D, S);
    expect(orig[0].fieldId).toBe(D);
  });
});
