// server/__tests__/occurrenceSchema.test.js
// Uses mongoose validateSync() — no real DB connection needed.
import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

let Occurrence;
beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect("mongodb://127.0.0.1/moduli_test_schema", {
      serverSelectionTimeoutMS: 500,
    }).catch(() => {});
  }
  const { default: Occ } = await import("../models/Occurrence.js");
  Occurrence = Occ;
});

function makeValid(overrides = {}) {
  return new Occurrence({
    id: "occ-1",
    userId: "user-1",
    targetType: "module",
    targetId: "mod-1",
    gridId: "grid-1",
    ...overrides,
  });
}

describe("Occurrence schema validation", () => {
  it("valid occurrence passes validation", () => {
    const occ = makeValid();
    const err = occ.validateSync();
    expect(err).toBeUndefined();
  });

  it("targetType enum enforced — module is valid", () => {
    const occ = makeValid({ targetType: "module" });
    const err = occ.validateSync();
    expect(err).toBeUndefined();
  });

  it("targetType enum enforced — invalid value fails", () => {
    const occ = makeValid({ targetType: "panel" });
    const err = occ.validateSync();
    expect(err).toBeDefined();
    expect(err.errors["targetType"]).toBeDefined();
  });

  it("targetType enum enforced — 'doc' is no longer valid", () => {
    const occ = makeValid({ targetType: "doc" });
    const err = occ.validateSync();
    expect(err).toBeDefined();
    expect(err.errors["targetType"]).toBeDefined();
  });

  it("filterOverride defaults to null", () => {
    const occ = makeValid();
    expect(occ.filterOverride).toBeNull();
  });

  it("hidden defaults to false", () => {
    const occ = makeValid();
    expect(occ.hidden).toBe(false);
  });

  it("fields defaults to empty object", () => {
    const occ = makeValid();
    expect(occ.fields).toEqual({});
  });

  it("linkedGroupId defaults to null", () => {
    const occ = makeValid();
    expect(occ.linkedGroupId).toBeNull();
  });

  it("gridId is required — missing gridId fails", () => {
    const occ = makeValid({ gridId: undefined });
    const err = occ.validateSync();
    expect(err).toBeDefined();
    expect(err.errors["gridId"]).toBeDefined();
  });
});

test("Occurrence accepts filterNavConfig", () => {
  const occ = new Occurrence({
    id: "test-1", userId: "u1", targetId: "m1", targetType: "module",
    filterNavConfig: { f1: { visible: true, style: "pills", options: ["a","b"] } },
  });
  expect(occ.filterNavConfig.f1.style).toBe("pills");
});

test("Occurrence meta accepts appliedFromTemplateId", () => {
  const occ = new Occurrence({
    id: "test-2", userId: "u1", targetId: "m1", targetType: "module",
    meta: { appliedFromTemplateId: "tpl-123" },
  });
  expect(occ.meta.appliedFromTemplateId).toBe("tpl-123");
});
