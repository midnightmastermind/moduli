// server/__tests__/operationSchema.test.js
// Uses mongoose validateSync() — no real DB connection needed.
import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

let Operation;
beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect("mongodb://127.0.0.1/moduli_test_schema", {
      serverSelectionTimeoutMS: 500,
    }).catch(() => {});
  }
  const { default: Op } = await import("../models/Operation.js");
  Operation = Op;
});

function makeValid(overrides = {}) {
  return new Operation({
    id: "op-1",
    userId: "user-1",
    gridId: "grid-1",
    ...overrides,
  });
}

describe("Operation schema validation", () => {
  it("valid operation passes validation", () => {
    const op = makeValid();
    const err = op.validateSync();
    expect(err).toBeUndefined();
  });

  it("triggerType enum enforced — valid values pass", () => {
    for (const t of ["onChange", "onDrop", "onInterval", "onIteration", "manual"]) {
      const op = makeValid({ triggerType: t });
      const err = op.validateSync();
      expect(err, `triggerType "${t}" should be valid`).toBeUndefined();
    }
  });

  it("triggerType accepts any string — open enum (generalized trigger system)", () => {
    // triggerType is now a free-form string; any event name is valid
    for (const t of ["onMagic", "onChange", "onAdd", "onWebhook", "onButton"]) {
      const op = makeValid({ triggerType: t });
      const err = op.validateSync();
      expect(err, `triggerType "${t}" should be valid`).toBeUndefined();
    }
  });

  it("triggerType defaults to manual", () => {
    const op = makeValid();
    expect(op.triggerType).toBe("manual");
  });

  it("enabled defaults to true", () => {
    const op = makeValid();
    expect(op.enabled).toBe(true);
  });

  it("targetFieldId is optional — null passes", () => {
    const op = makeValid({ targetFieldId: null });
    const err = op.validateSync();
    expect(err).toBeUndefined();
  });

  it("pipeline is Mixed — any shape passes", () => {
    const op = makeValid({ pipeline: { sources: [], steps: [{ type: "action" }] } });
    const err = op.validateSync();
    expect(err).toBeUndefined();
  });

  it("name defaults to Untitled Operation", () => {
    const op = makeValid();
    expect(op.name).toBe("Untitled Operation");
  });
});
