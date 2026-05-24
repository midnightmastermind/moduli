import { describe, it, expect } from "vitest";
import { parseSlotLabel, isTimeslotPassed } from "../helpers/timeslotPassed";

describe("parseSlotLabel", () => {
  it("parses am hours", () => {
    expect(parseSlotLabel("6:00am")).toEqual({ h: 6, min: 0 });
    expect(parseSlotLabel("11:30am")).toEqual({ h: 11, min: 30 });
  });
  it("parses pm hours", () => {
    expect(parseSlotLabel("1:00pm")).toEqual({ h: 13, min: 0 });
    expect(parseSlotLabel("11:45pm")).toEqual({ h: 23, min: 45 });
  });
  it("handles 12am/12pm boundary", () => {
    expect(parseSlotLabel("12:00am")).toEqual({ h: 0, min: 0 });
    expect(parseSlotLabel("12:00pm")).toEqual({ h: 12, min: 0 });
  });
  it("returns null for unparseable input", () => {
    expect(parseSlotLabel("noon")).toBeNull();
    expect(parseSlotLabel("")).toBeNull();
    expect(parseSlotLabel(null)).toBeNull();
    expect(parseSlotLabel("9:00")).toBeNull();
  });
});

describe("isTimeslotPassed", () => {
  const mkNow = (h, min = 0) => {
    const d = new Date(2026, 4, 23, h, min, 0); // local time
    return d;
  };

  it("returns true when slot is earlier in the day", () => {
    const now = mkNow(14); // 2pm
    expect(isTimeslotPassed({ slotLabel: "9:00am", now })).toBe(true);
    expect(isTimeslotPassed({ slotLabel: "1:00pm", now })).toBe(true);
  });

  it("returns false when slot is later in the day", () => {
    const now = mkNow(10); // 10am
    expect(isTimeslotPassed({ slotLabel: "3:00pm", now })).toBe(false);
    expect(isTimeslotPassed({ slotLabel: "11:30am", now })).toBe(false);
  });

  it("returns false at the exact slot hour (slot just started)", () => {
    const now = mkNow(9, 0); // 9:00 sharp
    expect(isTimeslotPassed({ slotLabel: "9:00am", now })).toBe(false);
  });

  it("returns false on bad slotLabel", () => {
    const now = mkNow(14);
    expect(isTimeslotPassed({ slotLabel: "garbage", now })).toBe(false);
    expect(isTimeslotPassed({ slotLabel: null, now })).toBe(false);
  });

  it("returns false when now is missing", () => {
    expect(isTimeslotPassed({ slotLabel: "9:00am", now: null })).toBe(false);
  });

  it("when containerDate is provided, only counts as passed if it's today", () => {
    const now = mkNow(14); // today = 2026-05-23 2pm
    expect(isTimeslotPassed({ slotLabel: "9:00am", containerDate: "2026-05-23", now })).toBe(true);
    expect(isTimeslotPassed({ slotLabel: "9:00am", containerDate: "2026-05-22", now })).toBe(false);
    expect(isTimeslotPassed({ slotLabel: "9:00am", containerDate: "2026-05-24", now })).toBe(false);
  });

  it("handles 30-minute slot resolution", () => {
    const now = mkNow(10, 0); // 10:00 sharp
    expect(isTimeslotPassed({ slotLabel: "9:30am", now })).toBe(true);
    expect(isTimeslotPassed({ slotLabel: "10:30am", now })).toBe(false);
  });
});
