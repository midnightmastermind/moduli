import { describe, it, expect } from "vitest";
import { normalizeFilterDateValue } from "../helpers/dropHandlers";

describe("normalizeFilterDateValue", () => {
  it("passes through already-YYYY-MM-DD strings", () => {
    expect(normalizeFilterDateValue("2026-05-23")).toBe("2026-05-23");
  });

  it("strips the time component from ISO timestamps without UTC drift", () => {
    // We rely on the prefix slice for ISO strings — the time component
    // shouldn't affect the day-key ("the filter is on the 23rd"), so output
    // must be 2026-05-23 even when the timestamp is UTC midnight.
    expect(normalizeFilterDateValue("2026-05-23T00:00:00.000Z")).toBe("2026-05-23");
    expect(normalizeFilterDateValue("2026-05-23T17:00:00.000Z")).toBe("2026-05-23");
  });

  it("formats Date objects via local-tz parts", () => {
    const d = new Date(2026, 4, 23, 12, 0, 0); // May (month index 4) 23, noon local
    expect(normalizeFilterDateValue(d)).toBe("2026-05-23");
  });

  it("returns null for null/undefined/empty", () => {
    expect(normalizeFilterDateValue(null)).toBe(null);
    expect(normalizeFilterDateValue(undefined)).toBe(null);
    expect(normalizeFilterDateValue("")).toBe(null);
  });

  it("returns null for unparseable strings", () => {
    expect(normalizeFilterDateValue("not a date")).toBe(null);
  });

  it("returns null for non-Date objects", () => {
    expect(normalizeFilterDateValue({ year: 2026 })).toBe(null);
    expect(normalizeFilterDateValue(42)).toBe(null);
  });
});
