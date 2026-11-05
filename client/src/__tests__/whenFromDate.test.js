// An operation can store a plain date in a Schedule/Reminder field. It read as nothing ("Schedule: —") and never fired.
import { describe, it, expect } from "vitest";
import { toWhen, isWhen, describeWhen, whenTimesOnDay, nextFireAfter } from "../helpers/when";

describe("a plain date in a when field", () => {
  it("is a one-time when", () => {
    expect(toWhen("2026-11-05")).toEqual({ mode: "once", dates: ["2026-11-05"] });
    expect(toWhen("2026-11-05T09:30")).toEqual({ mode: "once", dates: ["2026-11-05"], time: "09:30" });
  });
  it("reads and fires like one", () => {
    expect(isWhen("2026-11-05")).toBe(true);
    expect(describeWhen("2026-11-05")).toBe(describeWhen({ mode: "once", dates: ["2026-11-05"] }));
    expect(whenTimesOnDay("2026-11-05T09:30", "2026-11-05")).toEqual(["09:30"]);
    expect(whenTimesOnDay("2026-11-05", "2026-11-06")).toEqual([]);
    expect(nextFireAfter("2030-01-02T09:30", new Date(2030, 0, 1))).toBeTruthy();
  });
  it("anything else is left alone — the control", () => {
    expect(toWhen("soon")).toBe("soon");
    expect(isWhen("soon")).toBe(false);
    expect(isWhen(null)).toBe(false);
    const o = { mode: "weekdays", days: [1] };
    expect(toWhen(o)).toBe(o);
  });
});
