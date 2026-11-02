// TIME_SLOT's rule (helpers/when.slotOfMoment): the half-hour slot a moment falls in, in this browser's zone.
import { describe, it, expect } from "vitest";
import { slotOfMoment } from "../helpers/when.js";

describe("slotOfMoment", () => {
  it("an ISO instant is read in the local zone and floored to the half hour", () => {
    expect(slotOfMoment(new Date(2026, 10, 1, 20, 10).toISOString())).toBe("8:00pm");
    expect(slotOfMoment(new Date(2026, 10, 1, 9, 45).toISOString())).toBe("9:30am");
    expect(slotOfMoment(new Date(2026, 10, 1, 0, 5))).toBe("12:00am");
  });
  it("a clock string is read as written", () => {
    expect(slotOfMoment("20:10")).toBe("8:00pm");
  });
  it("a bare date, empty or unreadable value has no slot", () => {
    expect(slotOfMoment("2026-11-01")).toBeNull();
    expect(slotOfMoment("")).toBeNull();
    expect(slotOfMoment(null)).toBeNull();
    expect(slotOfMoment("2026-11-01Tgarbage")).toBeNull();
  });
});
