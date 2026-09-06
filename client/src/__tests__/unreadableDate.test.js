// A date field holding something that is not a date must SAY SO, not invent one.
//
// User, 2026-09-06: *"Tracker date for monthly bills says Invalid Date - 0d
// overdue. should be no overdue."*
//
// THE ENGINE MATTERS AND IT IS WHY THE STRING LOOKED LIKE THAT. The stored
// value was "September 2026" (my own 0291 wrote it into a DATE-typed field).
// `new Date("September 2026")` PARSES in V8 — to Sept 1 — so on Chrome that
// tile reads "Sep 1 · 5d overdue"; Firefox, which the user runs, refuses it
// and answers Invalid Date. Two engines, two different wrong answers, one
// cause: a month name is not a date value.
//
// The renderer half is still a real defect, independent of the data: for an
// unparseable value `dayDiffFromToday` correctly answered null, and the display
// branch never checked — null falls through EVERY comparison (`null > 0` is
// false) into `Math.abs(null)`, which is 0. So a value nobody could parse
// rendered as a confident "0d overdue".
import { describe, it, expect } from "vitest";
import { dayDiffFromToday, isOverdueDate } from "../ui/Field.jsx";

describe("an unreadable date", () => {
  it("is not a day difference", () => {
    expect(dayDiffFromToday("not a date at all")).toBeNull();
    expect(dayDiffFromToday("")).toBeNull();
  });

  // The control, and it is the one that matters: the helper was never wrong.
  // Only the branch that READ it was — so a test asserting "null for garbage"
  // alone would have passed against the bug. This pins the reader's contract.
  it("is not overdue — a reader must not treat null as a past date", () => {
    expect(isOverdueDate("not a date at all")).toBe(false);
    expect(isOverdueDate("2020-01-01")).toBe(true);   // a real past date IS
  });

  it("still reads a real date", () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(dayDiffFromToday(iso)).toBe(0);
  });
});
