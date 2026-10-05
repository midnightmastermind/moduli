import { describe, it, expect } from "vitest";
import { bumpChangedFieldTimestamps } from "../utils/fieldTimestamps.js";

const prev = { done: { value: true, flow: "in" }, on: { value: "2026-10-05", flow: "replace", timestamp: 1 } };
const prevTs = { done: 100, on: 100 };

describe("bumpChangedFieldTimestamps", () => {
  it("bumps only the field whose value changed — the whole map is sent, one field was edited", () => {
    const next = bumpChangedFieldTimestamps(prev, prevTs, { done: { value: false, flow: "in" }, on: { value: "2026-10-05", flow: "replace", timestamp: 1 } }, 500);
    expect(next).toEqual({ done: 500, on: 100 });
  });
  it("a cell timestamp alone is not a change", () => {
    expect(bumpChangedFieldTimestamps(prev, prevTs, { on: { value: "2026-10-05", flow: "replace", timestamp: 999 } }, 500).on).toBe(100);
  });
  it("a flow flip is a change", () => {
    expect(bumpChangedFieldTimestamps(prev, prevTs, { done: { value: true, flow: "out" } }, 500).done).toBe(500);
  });
  it("a new field, or one never stamped, is bumped", () => {
    expect(bumpChangedFieldTimestamps(prev, {}, { done: { value: true, flow: "in" }, x: { value: 1 } }, 500)).toEqual({ done: 500, x: 500 });
  });
  it("null replacing a value is a change", () => {
    expect(bumpChangedFieldTimestamps(prev, prevTs, { on: { value: null, flow: "replace" } }, 500).on).toBe(500);
  });
});
