// Which days a due-dated task belongs in.
//
// User, 2026-08-07: "stuff with a due date should be put in the Due slot,
// everyday until its due … if its completed and on the schedule, we can stop
// displaying it the next day."
//
// The MECHANISM is one occurrence multi-parented into each day (user's decision
// the same day), which is what makes the completion rule trivial: tick it once
// and it is complete everywhere, so "stop showing it tomorrow" is a fact about
// the row rather than something a builder reconstructs by scanning previous days
// for a copy that happens to be ticked. This file only decides WHICH DAYS.

import { describe, it, expect } from "vitest";
import { isDueOn, daysDueOn, dayKey } from "../helpers/dueSpan.js";

const WEEK = ["2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"];

describe("dayKey — local day keys, never toISOString", () => {
  it("passes a day key through and slices an ISO datetime", () => {
    expect(dayKey("2026-08-11")).toBe("2026-08-11");
    expect(dayKey("2026-08-11T22:30:00.000Z")).toBe("2026-08-11");
  });

  it("reads a Date by LOCAL parts", () => {
    // toISOString() west of UTC returns tomorrow after local evening — the bug
    // this codebase had to fix in $today and the filter-nav defaults.
    const d = new Date(2026, 7, 11, 23, 30); // local 11 Aug, 23:30
    expect(dayKey(d)).toBe("2026-08-11");
  });

  it("returns null for junk rather than a wrong day", () => {
    for (const j of [null, undefined, "", "soon", new Date("nope")]) {
      expect(dayKey(j)).toBeNull();
    }
  });
});

describe("the user's real task: Talk to Angela, due Aug 11", () => {
  const task = { due: "2026-08-11" };

  it("shows every day up to AND INCLUDING the due date", () => {
    expect(daysDueOn(task, WEEK.slice(0, 4)))
      .toEqual(["2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11"]);
  });

  it("nags for THREE DAYS once overdue, then lets go", () => {
    // CONTRACT CHANGED 2026-08-18, and this test is updated rather than deleted
    // because the old behaviour was itself a deliberate decision. It used to
    // keep showing forever — "a task vanishing because its date went by is
    // indistinguishable from losing it". The user has since asked for the
    // opposite: "not put past dues in the todo list after 3 days, just leave
    // them in the tasks folder so i can delete them."
    //
    // The original worry does not apply, which is why the reversal is safe:
    // this decides only which days the SCHEDULE lists it on. The task stays on
    // the Tasks page — exactly where the user asked to go and delete it.
    expect(isDueOn(task, "2026-08-12")).toBe(true);   // 1 day over
    expect(isDueOn(task, "2026-08-14")).toBe(true);   // 3 days over — the last
    expect(isDueOn(task, "2026-08-15")).toBe(false);  // 4 days over — gone
    expect(isDueOn(task, "2026-09-01")).toBe(false);
  });
});

describe("completion — gone the NEXT day, kept on the day it was done", () => {
  it("stops the day after it was completed", () => {
    const task = { due: "2026-08-11", completedOn: "2026-08-09" };
    expect(daysDueOn(task, WEEK)).toEqual(["2026-08-08", "2026-08-09"]);
  });

  it("KEEPS it on the day it was completed, so that day reads truthfully", () => {
    // The discriminating half. Dropping it from the completion day too would
    // erase the fact that you did it, which is the opposite of the point.
    const task = { due: "2026-08-11", completedOn: "2026-08-09" };
    expect(isDueOn(task, "2026-08-09")).toBe(true);
    expect(isDueOn(task, "2026-08-10")).toBe(false);
  });

  it("completing AFTER the due date still cuts it off correctly", () => {
    const task = { due: "2026-08-09", completedOn: "2026-08-12" };
    expect(daysDueOn(task, WEEK))
      .toEqual(["2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(isDueOn(task, "2026-08-13")).toBe(false);
  });
});

describe("`from` — what stops 'every day' meaning every day in history", () => {
  it("does not show before the task existed", () => {
    const task = { due: "2026-08-11", from: "2026-08-10" };
    expect(daysDueOn(task, WEEK)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("with no `from`, there is no lower bound — the caller bounds the period", () => {
    expect(isDueOn({ due: "2026-08-11" }, "2020-01-01")).toBe(true);
  });

  it("`from` and completion compose", () => {
    const task = { due: "2026-08-12", from: "2026-08-09", completedOn: "2026-08-10" };
    expect(daysDueOn(task, WEEK)).toEqual(["2026-08-09", "2026-08-10"]);
  });
});

describe("refusals", () => {
  it("a task with NO due date belongs in no day's Due slot", () => {
    // "Work on Paul's website" — no due date, so it lives on the Tasks page in a
    // container, never in Due. It must not leak into the Schedule.
    expect(isDueOn({}, "2026-08-08")).toBe(false);
    expect(daysDueOn({ completedOn: "2026-08-09" }, WEEK)).toEqual([]);
  });

  it("junk day or junk due date yields false, never a throw", () => {
    expect(isDueOn({ due: "2026-08-11" }, null)).toBe(false);
    expect(isDueOn({ due: "nope" }, "2026-08-08")).toBe(false);
    expect(isDueOn(null, "2026-08-08")).toBe(false);
    expect(daysDueOn(null, WEEK)).toEqual([]);
  });
});
