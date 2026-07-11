// server/__tests__/fieldSchema.test.js
// Uses mongoose validateSync() — no real DB connection needed.
import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

// Suppress "OverwriteModelError" when running all test files in same process
let Field;
beforeAll(async () => {
  // Use in-memory connection (no external DB)
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect("mongodb://127.0.0.1/moduli_test_schema", {
      serverSelectionTimeoutMS: 500,
    }).catch(() => {
      // If no local DB, use a fake connection for schema-only tests
    });
  }
  const { default: F } = await import("../models/Field.js");
  Field = F;
});

function makeValid(overrides = {}) {
  return new Field({
    id: "field-1",
    userId: "user-1",
    gridId: "grid-1",
    name: "My Field",
    type: "number",
    ...overrides,
  });
}

describe("Field schema validation", () => {
  it("valid field passes validation", () => {
    const f = makeValid();
    const err = f.validateSync();
    expect(err).toBeUndefined();
  });

  it("type enum is enforced — invalid type fails", () => {
    const f = makeValid({ type: "invalid-type" });
    const err = f.validateSync();
    expect(err).toBeDefined();
    expect(err.errors["type"]).toBeDefined();
  });

  it("all valid type values pass", () => {
    const validTypes = ["number", "text", "boolean", "select", "date", "rating", "duration", "occurrence", "markdown", "button"];
    for (const t of validTypes) {
      const f = makeValid({ type: t });
      const err = f.validateSync();
      expect(err, `type "${t}" should be valid`).toBeUndefined();
    }
  });

  it("name is required — missing name fails", () => {
    const f = makeValid({ name: undefined });
    const err = f.validateSync();
    expect(err).toBeDefined();
    expect(err.errors["name"]).toBeDefined();
  });

  it("userId is required — missing userId fails", () => {
    const f = makeValid({ userId: undefined });
    const err = f.validateSync();
    expect(err).toBeDefined();
    expect(err.errors["userId"]).toBeDefined();
  });

  it("inputEnabled defaults to true", () => {
    const f = makeValid();
    expect(f.inputEnabled).toBe(true);
  });

  it("displayEnabled defaults to false", () => {
    const f = makeValid();
    expect(f.displayEnabled).toBe(false);
  });

  it("displayConfig is Mixed — preserves arbitrary keys (targetOp/startValue/columns)", () => {
    // The old structured sub-schema silently STRIPPED unknown keys (targetOp,
    // startValue, columns) — "Tasks Left" rendered green at 10/0 because its
    // "<=" op was dropped. Mixed must round-trip whatever the client stores.
    const f = makeValid();
    f.displayConfig = { targetValue: 0, targetOp: "<=", startValue: 10, columns: [{ path: "a" }] };
    const err = f.validateSync();
    expect(err).toBeUndefined();
    expect(f.displayConfig.targetOp).toBe("<=");
    expect(f.displayConfig.startValue).toBe(10);
    expect(f.displayConfig.columns).toEqual([{ path: "a" }]);
  });

  it("folderId defaults to null", () => {
    const f = makeValid();
    expect(f.folderId).toBeNull();
  });
});
