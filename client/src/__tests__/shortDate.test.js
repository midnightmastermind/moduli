import { describe, it, expect } from "vitest";
import { shortDate } from "../ui/Field";
const now = new Date("2026-09-26T12:00:00");
describe("shortDate", () => {
  it("keeps this year's dates short", () => {
    expect(shortDate(new Date("2026-09-23T00:00:00"), now)).not.toMatch(/2026/);
  });
  it("shows the year for any other year", () => {
    expect(shortDate(new Date("1982-08-21T00:00:00"), now)).toMatch(/1982/);
    expect(shortDate(new Date("2021-07-12T00:00:00"), now)).toMatch(/2021/);
  });
  it("an invalid date is null", () => { expect(shortDate(new Date("x"), now)).toBeNull(); });
});
