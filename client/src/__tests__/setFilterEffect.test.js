// __tests__/setFilterEffect.test.js
import { describe, it, expect } from "vitest";
import { applySetFilterEffect } from "../state/bindSocketToStore";

describe("applySetFilterEffect", () => {
  const state = { grid: { _id: "g1", activeFilterValues: { f_date: "2026-07-25" } }, filterNavState: {} };

  it("writes both the nav display and the filter cascade value", () => {
    const out = applySetFilterEffect({ fieldId: "f_date", value: "2026-07-26" }, state);
    expect(out.navValue).toEqual({ key: "f_date", value: "2026-07-26" });
    expect(out.gridPatch).toEqual({ activeFilterValues: { f_date: "2026-07-26" } });
    expect(out.gridId).toBe("g1");
  });

  it("short-circuits when the value is already set — an onLoad op must not loop", () => {
    const out = applySetFilterEffect(
      { fieldId: "f_date", value: "2026-07-25" },
      { ...state, filterNavState: { f_date: "2026-07-25" } });
    expect(out).toBeNull();
  });

  it("still writes when the nav matches but the cascade has not caught up", () => {
    const out = applySetFilterEffect(
      { fieldId: "f_date", value: "2026-07-26" },
      { ...state, filterNavState: { f_date: "2026-07-26" } });
    expect(out).not.toBeNull();
    expect(out.gridPatch.activeFilterValues.f_date).toBe("2026-07-26");
  });

  it("treats the object-shaped cascade value as set", () => {
    const out = applySetFilterEffect(
      { fieldId: "f_date", value: "2026-07-26" },
      {
        grid: { _id: "g1", activeFilterValues: { f_date: { value: "2026-07-26", unit: "day" } } },
        filterNavState: { f_date: "2026-07-26" },
      });
    expect(out).toBeNull();
  });

  it("keeps the other filter values when patching one", () => {
    const out = applySetFilterEffect(
      { fieldId: "f_date", value: "2026-07-26" },
      { grid: { _id: "g1", activeFilterValues: { f_date: "2026-07-25", f_other: "x" } }, filterNavState: {} });
    expect(out.gridPatch.activeFilterValues).toEqual({ f_date: "2026-07-26", f_other: "x" });
  });

  it("ignores an effect with no target", () => {
    expect(applySetFilterEffect({ value: "2026-07-26" }, state)).toBeNull();
  });
});
