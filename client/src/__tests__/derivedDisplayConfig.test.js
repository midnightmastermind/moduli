// C1 — a displayConfig value that FOLLOWS another field's, so the tasks goal is
// one number instead of two that can silently disagree.
import { describe, it, expect } from "vitest";
import { resolveDisplayConfig, derivationOf } from "../helpers/derivedDisplayConfig";

const completed = {
  id: "fCompleted", name: "Tasks Completed",
  displayConfig: { startValue: 0, targetValue: 5, targetOp: ">=", targetPeriod: "daily" },
};
const left = {
  id: "fLeft", name: "Tasks Left",
  displayConfig: { startValue: 99, targetValue: 0, targetOp: "<=", targetPeriod: "daily" },
  meta: { deriveDisplayFrom: { fieldId: "fCompleted", from: "targetValue", to: "startValue" } },
};
const byId = { fCompleted: completed, fLeft: left };

describe("derivationOf", () => {
  it("accepts a well-formed derivation", () => {
    expect(derivationOf(left)).toEqual({ fieldId: "fCompleted", from: "targetValue", to: "startValue" });
  });

  it("returns null for a field that declares none", () => {
    expect(derivationOf(completed)).toBeNull();
    expect(derivationOf({})).toBeNull();
    expect(derivationOf(null)).toBeNull();
  });

  // A key outside DERIVABLE_KEYS would let a derivation write anything on
  // displayConfig — columns, targetOp — from a field that knows nothing about it.
  it("refuses keys outside the allow-list", () => {
    const bad = { ...left, meta: { deriveDisplayFrom: { fieldId: "fCompleted", from: "columns", to: "columns" } } };
    expect(derivationOf(bad)).toBeNull();
  });

  it("refuses a field following ITSELF", () => {
    const selfRef = { ...left, meta: { deriveDisplayFrom: { fieldId: "fLeft", from: "targetValue", to: "startValue" } } };
    expect(derivationOf(selfRef)).toBeNull();
  });

  it("refuses a malformed shape", () => {
    for (const d of [{ fieldId: "" }, { fieldId: 5, from: "targetValue", to: "startValue" }, "nope", 7, []]) {
      expect(derivationOf({ ...left, meta: { deriveDisplayFrom: d } })).toBeNull();
    }
  });
});

describe("resolveDisplayConfig", () => {
  it("fills the derived key from the source field", () => {
    const out = resolveDisplayConfig(left, byId);
    expect(out.displayConfig.startValue).toBe(5);           // follows Completed's target
    expect(out.displayConfig.targetValue).toBe(0);          // its own values survive
    expect(out.displayConfig.targetOp).toBe("<=");
    expect(out.displayConfig.targetPeriod).toBe("daily");
  });

  // THE POINT OF THE FEATURE: edit ONE number and the pair moves together.
  it("tracks the source when the source changes", () => {
    const edited = { ...completed, displayConfig: { ...completed.displayConfig, targetValue: 12 } };
    const out = resolveDisplayConfig(left, { ...byId, fCompleted: edited });
    expect(out.displayConfig.startValue).toBe(12);
  });

  it("does not mutate the input field", () => {
    const before = JSON.stringify(left);
    resolveDisplayConfig(left, byId);
    expect(JSON.stringify(left)).toBe(before);
  });

  // Identity matters: this runs inside a render memo, so returning a new object
  // when nothing changed would re-render every goal tile on every pass.
  it("returns the SAME object when nothing is derived or nothing changed", () => {
    expect(resolveDisplayConfig(completed, byId)).toBe(completed);
    const already = { ...left, displayConfig: { ...left.displayConfig, startValue: 5 } };
    expect(resolveDisplayConfig(already, byId)).toBe(already);
  });

  // FAILS SOFT. A goal tile rendering nothing is worse than one showing a
  // slightly stale anchor, so every unresolvable case keeps the stored value.
  it("keeps the stored value when the source is missing, empty, or itself derived", () => {
    expect(resolveDisplayConfig(left, {}).displayConfig.startValue).toBe(99);
    const noTarget = { ...completed, displayConfig: { startValue: 0 } };
    expect(resolveDisplayConfig(left, { ...byId, fCompleted: noTarget }).displayConfig.startValue).toBe(99);
    // one hop only — a chain is refused rather than half-followed
    const chained = { ...completed, meta: { deriveDisplayFrom: { fieldId: "fOther", from: "targetValue", to: "targetValue" } } };
    expect(resolveDisplayConfig(left, { ...byId, fCompleted: chained }).displayConfig.startValue).toBe(99);
  });

  it("is null-safe", () => {
    expect(resolveDisplayConfig(null, byId)).toBeNull();
    expect(resolveDisplayConfig(left, null)).toBe(left);
  });
});
