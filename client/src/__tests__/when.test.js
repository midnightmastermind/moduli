import { describe, it, expect } from "vitest";
import { isWhen, whenTimesOnDay, whenOnDay, lastFireAtOrBefore, nextFireAfter, describeWhen, slotLabelFor } from "../helpers/when.js";

describe("when values", () => {
  it("once falls on its day only", () => {
    const v = { mode: "once", date: "2026-10-13", time: "14:30" };
    expect(whenTimesOnDay(v, "2026-10-13")).toEqual(["14:30"]);
    expect(whenOnDay(v, "2026-10-14")).toBe(false);
  });
  it("every N days / weeks / months counts from the start, never before it", () => {
    const d = { mode: "every", every: 2, unit: "day", start: { date: "2026-10-13", time: "09:00" } };
    expect(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].map((x) => whenOnDay(d, x))).toEqual([false, true, false, true]);
    const w = { mode: "every", every: 1, unit: "week", start: { date: "2026-10-13" } };
    expect(whenOnDay(w, "2026-10-20")).toBe(true);
    expect(whenOnDay(w, "2026-10-21")).toBe(false);
    const m = { mode: "every", every: 1, unit: "month", start: { date: "2026-10-13" } };
    expect(whenOnDay(m, "2026-11-13")).toBe(true);
    expect(whenOnDay(m, "2026-11-14")).toBe(false);
  });
  it("every N hours lists each time on the day", () => {
    const h = { mode: "every", every: 6, unit: "hour", start: { date: "2026-10-13", time: "08:00" } };
    expect(whenTimesOnDay(h, "2026-10-13")).toEqual(["08:00", "14:00", "20:00"]);
    expect(whenTimesOnDay(h, "2026-10-14")).toEqual(["02:00", "08:00", "14:00", "20:00"]);
  });
  it("weekdays repeats on the chosen days", () => {
    const v = { mode: "weekdays", days: [1, 3, 5], time: "09:00" };
    expect(whenOnDay(v, "2026-10-12")).toBe(true);   // Monday
    expect(whenOnDay(v, "2026-10-13")).toBe(false);  // Tuesday
    expect(describeWhen(v)).toBe("Mon, Wed, Fri at 9:00am");
  });
  it("finds the last and next fire moments", () => {
    const v = { mode: "weekdays", days: [1], time: "09:00" };
    const now = new Date(2026, 9, 12, 10, 0);
    expect(lastFireAtOrBefore(v, now)).toEqual(new Date(2026, 9, 12, 9, 0));
    expect(nextFireAfter(v, now)).toEqual(new Date(2026, 9, 19, 9, 0));
    expect(lastFireAtOrBefore({ mode: "once", date: "2026-10-13", time: "09:00" }, now)).toBe(null);
  });
  it("rejects incomplete values and floors times to a slot", () => {
    expect(isWhen({ mode: "every", every: 0, unit: "day", start: { date: "2026-10-13" } })).toBe(false);
    expect(isWhen({ mode: "weekdays", days: [] })).toBe(false);
    expect(slotLabelFor("14:40")).toBe("2:30pm");
    expect(slotLabelFor("00:10")).toBe("12:00am");
    expect(slotLabelFor(null)).toBe(null);
  });
});
