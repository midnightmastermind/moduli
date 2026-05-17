import { describe, it, expect } from "vitest";
import { resolveOptions } from "../helpers/optionsResolver";

const emptyCtx = { occurrencesById: {}, modulesById: {}, fieldsById: {}, foldersById: {} };

describe("resolveOptions — manual mode", () => {
  it("returns each value as {value, label} pair", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual", values: ["Apples", "Oranges"] } } };
    const { options, totalMatched } = resolveOptions(field, emptyCtx);
    expect(options).toEqual([
      { value: "Apples", label: "Apples" },
      { value: "Oranges", label: "Oranges" },
    ]);
    expect(totalMatched).toBe(2);
  });

  it("handles numeric values", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual", values: [1, 2, 3] } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([
      { value: 1, label: "1" },
      { value: 2, label: "2" },
      { value: 3, label: "3" },
    ]);
  });

  it("returns empty when values missing", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual" } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });
});

describe("resolveOptions — range mode", () => {
  it("expands [start, end] with step", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 1, end: 5, step: 1 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([
      { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" },
      { value: 4, label: "4" }, { value: 5, label: "5" },
    ]);
  });

  it("handles step > 1", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 0, end: 20, step: 5 } } } };
    expect(resolveOptions(field, emptyCtx).options.map(o => o.value)).toEqual([0, 5, 10, 15, 20]);
  });

  it("returns empty for invalid step", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 0, end: 5, step: 0 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });

  it("returns empty when end < start", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 5, end: 1, step: 1 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });
});

describe("resolveOptions — guards", () => {
  it("returns empty for non-select fields", () => {
    expect(resolveOptions({ type: "number", meta: {} }, emptyCtx).options).toEqual([]);
  });

  it("returns empty for missing optionsSource", () => {
    expect(resolveOptions({ type: "select", meta: {} }, emptyCtx).options).toEqual([]);
  });
});
