// An overdue task stops nagging after three days.
//
// User, 2026-08-18: "i also need you to not put past dues in the todo list after
// 3 days, just leave them in the tasks folder so i can delete them."
//
// This REVERSES the original reading (an overdue task had no upper bound at
// all), so these tests exist as much to pin the new decision as to check the
// arithmetic — the old behaviour was itself deliberate and documented.
import { describe, it, expect } from "vitest";
import { isDueOn, addDays, OVERDUE_GRACE_DAYS } from "../helpers/dueSpan";

const DUE = "2026-08-21";
const task = (extra = {}) => ({ due: DUE, ...extra });

describe("overdue grace window", () => {
  it("still lists it on the due day itself", () => {
    expect(isDueOn(task(), DUE)).toBe(true);
  });

  it("keeps nagging for exactly three days after", () => {
    for (let n = 1; n <= OVERDUE_GRACE_DAYS; n++) {
      expect(isDueOn(task(), addDays(DUE, n))).toBe(true);
    }
  });

  it("THE ONE THAT MATTERS: drops off on the fourth day", () => {
    expect(isDueOn(task(), addDays(DUE, OVERDUE_GRACE_DAYS + 1))).toBe(false);
  });

  it("stays long gone, not just missing for a day", () => {
    expect(isDueOn(task(), addDays(DUE, 30))).toBe(false);
  });

  it("still lists it on every day BEFORE the due date", () => {
    expect(isDueOn(task(), addDays(DUE, -5))).toBe(true);
  });

  it("a completed task is still governed by its completion, not the window", () => {
    // Completed the day before it was due: gone from the next day on, which is
    // well inside the grace window — the two rules must not fight.
    const t = task({ completedOn: addDays(DUE, -1) });
    expect(isDueOn(t, addDays(DUE, -1))).toBe(true);
    expect(isDueOn(t, DUE)).toBe(false);
  });

  it("addDays crosses a month boundary without drifting", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
