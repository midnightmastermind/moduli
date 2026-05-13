// server/__tests__/moduleSchema.test.js
// Uses mongoose validateSync() — no real DB connection needed.
import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

let Module;
beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect("mongodb://127.0.0.1/moduli_test_schema", {
      serverSelectionTimeoutMS: 500,
    }).catch(() => {});
  }
  const { default: M } = await import("../models/Module.js");
  Module = M;
});

function makeValid(overrides = {}) {
  return new Module({
    id: "mod-1",
    userId: "user-1",
    gridId: "grid-1",
    ...overrides,
  });
}

describe("Module schema validation", () => {
  it("valid module passes validation (no role/kind required)", () => {
    const m = makeValid();
    const err = m.validateSync();
    expect(err).toBeUndefined();
  });

  it("role is optional — module saves without role", () => {
    const m = makeValid({ role: undefined });
    const err = m.validateSync();
    expect(err).toBeUndefined();
  });

  it("role accepts any string value (no enum enforcement)", () => {
    const m = makeValid({ role: "widget" });
    const err = m.validateSync();
    expect(err).toBeUndefined();
  });

  it("kind is optional — module saves without kind", () => {
    const m = makeValid({ kind: undefined });
    const err = m.validateSync();
    expect(err).toBeUndefined();
  });

  it("label defaults to empty string", () => {
    const m = makeValid();
    expect(m.label).toBe("");
  });

  it("fieldBindings defaults to empty array", () => {
    const m = makeValid();
    expect(m.fieldBindings).toEqual([]);
  });

  it("behaviorMode defaults to inherit", () => {
    const m = makeValid();
    expect(m.behaviorMode).toBe("inherit");
  });

  it("behaviorMode enum enforced — invalid value fails", () => {
    const m = makeValid({ behaviorMode: "custom" });
    const err = m.validateSync();
    expect(err).toBeDefined();
    expect(err.errors["behaviorMode"]).toBeDefined();
  });

  it("behavior.sortable defaults to true", () => {
    const m = makeValid();
    expect(m.behavior.sortable).toBe(true);
  });

  it("behavior.draggable defaults to true", () => {
    const m = makeValid();
    expect(m.behavior.draggable).toBe(true);
  });

  it("behavior.droppable defaults to true", () => {
    const m = makeValid();
    expect(m.behavior.droppable).toBe(true);
  });

  it("meta.templateModule stores a boolean flag", () => {
    const m = makeValid({ meta: { templateModule: true } });
    const err = m.validateSync();
    expect(err).toBeUndefined();
    expect(m.meta.templateModule).toBe(true);
  });
});
