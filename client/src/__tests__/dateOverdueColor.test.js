// An overdue date must READ as overdue.
//
// User 2026-08-08: "the due field should be colored red if the date passed."
// Before this, `valueSignColor` fell through its string branch and painted
// EVERY non-empty date green — so a Due date three days past looked healthy.
import { describe, it, expect } from "vitest";
import { dayDiffFromToday, isOverdueDate } from "../ui/Field";

const iso = (offsetDays) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  // Local parts, never toISOString — that is UTC and drifts a day west of
  // Greenwich, which is the bug this helper exists to avoid.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("day distance from today", () => {
  it("counts forwards and backwards", () => {
    expect(dayDiffFromToday(iso(0))).toBe(0);
    expect(dayDiffFromToday(iso(3))).toBe(3);
    expect(dayDiffFromToday(iso(-3))).toBe(-3);
  });

  it("parses YYYY-MM-DD as LOCAL midnight, not UTC", () => {
    // The regression this guards: `new Date("2026-08-11")` is UTC midnight, so
    // anywhere west of Greenwich it is the 10th locally and today reads as -1.
    expect(dayDiffFromToday(iso(0))).toBe(0);
  });

  it("returns null for anything that is not a date", () => {
    expect(dayDiffFromToday(null)).toBeNull();
    expect(dayDiffFromToday("")).toBeNull();
    expect(dayDiffFromToday("not a date")).toBeNull();
  });
});

describe("overdue", () => {
  it("is true only once the day has PASSED", () => {
    expect(isOverdueDate(iso(-1))).toBe(true);
    expect(isOverdueDate(iso(-30))).toBe(true);
  });

  it("today is NOT overdue — you still have the day", () => {
    expect(isOverdueDate(iso(0))).toBe(false);
  });

  it("a future date is not overdue", () => {
    expect(isOverdueDate(iso(1))).toBe(false);
    expect(isOverdueDate(iso(365))).toBe(false);
  });

  it("an empty or unparseable value is not overdue", () => {
    // Must not paint an empty Due field red — nothing is late yet.
    expect(isOverdueDate(null)).toBe(false);
    expect(isOverdueDate("")).toBe(false);
    expect(isOverdueDate("someday")).toBe(false);
  });
});

// ── The wiring, not just the maths ───────────────────────────────────────────
// The four cases above passed with the colour branch DELETED — they only
// exercised the helpers. This block is the discriminating one: it asserts the
// colour a date actually resolves to.
import { valueSignColor } from "../ui/Field";

describe("the colour a date resolves to", () => {
  it("paints an overdue date with the DANGER token", () => {
    expect(valueSignColor(iso(-2), "date")).toBe("var(--danger-text)");
  });

  it("leaves an upcoming date green, and today green — today is not late", () => {
    expect(valueSignColor(iso(5), "date")).toBe("var(--accent-green-text)");
    expect(valueSignColor(iso(0), "date")).toBe("var(--accent-green-text)");
  });

  it("an empty date is neutral, NOT red — nothing is late yet", () => {
    expect(valueSignColor(null, "date")).toBe("var(--accent-blue-text, #bfdbfe)");
  });

  it("does not change any NON-date field's colour", () => {
    // The regression risk of adding a branch: every other type must be
    // byte-identical to before.
    expect(valueSignColor(5, "number")).toBe("var(--accent-green-text)");
    expect(valueSignColor(-5, "number")).toBe("var(--danger-text)");
    expect(valueSignColor(0, "number")).toBe("var(--accent-blue-text, #bfdbfe)");
    expect(valueSignColor(true, "boolean")).toBe("var(--accent-green-text)");
    expect(valueSignColor("some text", "text")).toBe("var(--accent-green-text)");
    // …and a date-LOOKING string on a text field stays green.
    expect(valueSignColor(iso(-2), "text")).toBe("var(--accent-green-text)");
  });
});
