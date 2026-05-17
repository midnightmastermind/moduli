import { describe, it, expect } from "vitest";
import { migrateFieldOptionsSource, needsMigration } from "../state/migrateFieldOptionsSource";

describe("migrateFieldOptionsSource", () => {
  it("rewrites meta.options into manual mode", () => {
    const field = { id: "f1", type: "select", meta: { options: ["Apples", "Oranges"], prefix: "$" } };
    const out = migrateFieldOptionsSource(field);
    expect(out.meta.optionsSource).toEqual({ mode: "manual", values: ["Apples", "Oranges"] });
    expect(out.meta.options).toBeUndefined();
    expect(out.meta.prefix).toBe("$");
  });

  it("rewrites pool fields into find mode with HAS_ANCESTOR (OR'd rules)", () => {
    const field = { id: "f1", type: "select", meta: { sourceType: "pool", poolContainerIds: ["c1", "c2"] } };
    const out = migrateFieldOptionsSource(field);
    expect(out.meta.optionsSource).toEqual({
      mode: "find",
      over: "$allInstances",
      predicate: {
        operator: "OR",
        rules: [
          { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "c1" },
          { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "c2" },
        ],
      },
      valuePath: "id",
      labelPath: "label",
    });
    expect(out.meta.sourceType).toBeUndefined();
    expect(out.meta.poolContainerIds).toBeUndefined();
  });

  it("treats legacy single poolContainerId as a one-entry list", () => {
    const field = { id: "f1", type: "select", meta: { sourceType: "pool", poolContainerId: "c1" } };
    const out = migrateFieldOptionsSource(field);
    expect(out.meta.optionsSource.predicate.rules[0].right).toEqual("c1");
    expect(out.meta.optionsSource.predicate.rules.length).toBe(1);
    expect(out.meta.poolContainerId).toBeUndefined();
  });

  it("produces manual{values:[]} when no options and no pool", () => {
    const field = { id: "f1", type: "select", meta: {} };
    const out = migrateFieldOptionsSource(field);
    expect(out.meta.optionsSource).toEqual({ mode: "manual", values: [] });
  });

  it("is a no-op for non-select fields", () => {
    const field = { id: "f1", type: "number", meta: { options: ["x"] } };
    expect(migrateFieldOptionsSource(field)).toBe(field);
  });

  it("is idempotent — already-migrated fields pass through unchanged", () => {
    const field = { id: "f1", type: "select", meta: { optionsSource: { mode: "manual", values: ["a"] } } };
    expect(migrateFieldOptionsSource(field)).toBe(field);
  });
});

describe("needsMigration", () => {
  it("returns true for legacy meta.options", () => {
    expect(needsMigration({ type: "select", meta: { options: ["x"] } })).toBe(true);
  });
  it("returns true for legacy pool fields", () => {
    expect(needsMigration({ type: "select", meta: { sourceType: "pool", poolContainerIds: ["c"] } })).toBe(true);
  });
  it("returns true for select fields with no optionsSource", () => {
    expect(needsMigration({ type: "select", meta: {} })).toBe(true);
  });
  it("returns false when optionsSource present", () => {
    expect(needsMigration({ type: "select", meta: { optionsSource: { mode: "manual", values: [] } } })).toBe(false);
  });
  it("returns false for non-select fields", () => {
    expect(needsMigration({ type: "number", meta: {} })).toBe(false);
  });
});
