// `$activeMonthLabel` — the month the grid's date filter is showing.
//
// A tracker whose window is a MONTH had nowhere to say so. The executor exposed
// `$activeDate` ("2026-09-05"), `$activeDateLabel` ("Sat, Sep 5") and
// `$activeDayOfWeek`, all of which name a DAY — so a monthly tile could only
// fall back to the literal "Total", which is what `Monthly Bills` showed while
// summing exactly the bills whose Cadence is monthly (user, 2026-09-05:
// *"bills should be monthly (Tracker Date should reflect that based on
// Filter)"*).
//
// It is DERIVED FROM THE SAME `d` the other labels use, so it can never
// disagree with them about which date is active.
import { describe, it, expect } from "vitest";
import { monthLabelOf } from "../helpers/dateVars";

describe("$activeMonthLabel", () => {
  it("names the month and year of the active date", () => {
    expect(monthLabelOf("2026-09-05")).toBe("September 2026");
  });

  it("follows the filter rather than the clock", () => {
    expect(monthLabelOf("2026-01-31")).toBe("January 2026");
    expect(monthLabelOf("2026-12-01")).toBe("December 2026");
  });

  // THE BOUNDARY THAT BITES: `new Date("2026-09-01")` is UTC midnight, which is
  // the PREVIOUS day — and therefore the previous MONTH — in every US timezone.
  // The first of the month must still read as that month.
  it("does not slip to the previous month on the 1st", () => {
    expect(monthLabelOf("2026-09-01")).toBe("September 2026");
    expect(monthLabelOf("2026-03-01")).toBe("March 2026");
  });

  // Accepts the Date the executor already has, so the two cannot disagree
  // about which date is active.
  it("takes a Date as well as a string", () => {
    expect(monthLabelOf(new Date(2026, 8, 5))).toBe("September 2026");
  });

  it("answers empty for nothing rather than inventing a month", () => {
    expect(monthLabelOf(null)).toBe("");
    expect(monthLabelOf("not-a-date")).toBe("");
  });
});
