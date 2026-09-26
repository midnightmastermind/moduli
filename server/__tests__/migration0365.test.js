import { describe, it, expect } from "vitest";
import { noYearDate } from "../migrations/0365-birthday-one-field.mjs";
describe("0365 noYearDate", () => {
  it("a month and day become 1900-MM-DD", () => {
    expect(noYearDate("June 27")).toBe("1900-06-27");
    expect(noYearDate("September 3")).toBe("1900-09-03");
    expect(noYearDate("Sep 3")).toBe("1900-09-03");
  });
  it("anything else is refused", () => {
    expect(noYearDate("")).toBeNull();
    expect(noYearDate("June 27, 1990")).toBeNull();
    expect(noYearDate("Blah 4")).toBeNull();
    expect(noYearDate("June 40")).toBeNull();
  });
});
