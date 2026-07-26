// __tests__/pomodoroSlotOption.test.js
import { describe, it, expect } from "vitest";
import { pickTimeOptionForNow } from "../ui/PomodoroTimer.jsx";

const OPTIONS = ["12:00am", "6:00am", "9:00am", "12:00pm", "5:00pm", "11:00pm"];

describe("pickTimeOptionForNow", () => {
  it("picks the latest option at or before now", () => {
    expect(pickTimeOptionForNow(OPTIONS, new Date(2026, 6, 25, 9, 30))).toBe("9:00am");
    expect(pickTimeOptionForNow(OPTIONS, new Date(2026, 6, 25, 17, 5))).toBe("5:00pm");
  });

  it("handles 24-hour option spellings too", () => {
    expect(pickTimeOptionForNow(["09:00", "13:00"], new Date(2026, 6, 25, 14, 0))).toBe("13:00");
  });

  it("returns null when there are no usable options", () => {
    expect(pickTimeOptionForNow([], new Date())).toBeNull();
    expect(pickTimeOptionForNow(["not a time"], new Date())).toBeNull();
  });

  it("returns null when every option is later than now", () => {
    expect(pickTimeOptionForNow(["5:00pm"], new Date(2026, 6, 25, 6, 0))).toBeNull();
  });

  it("treats 12am as midnight and 12pm as noon", () => {
    expect(pickTimeOptionForNow(["12:00am", "11:00pm"], new Date(2026, 6, 25, 0, 30))).toBe("12:00am");
    expect(pickTimeOptionForNow(["11:00am", "12:00pm"], new Date(2026, 6, 25, 12, 30))).toBe("12:00pm");
  });
});
