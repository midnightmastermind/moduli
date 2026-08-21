import { describe, it, expect } from "vitest";
import { evalRule } from "../helpers/operationActions";

// A bare "YYYY-MM-DD" is parsed by `new Date()` as UTC MIDNIGHT. Anywhere west
// of UTC that instant is the PREVIOUS local evening — so a naive
// `new Date(value) < localMidnight` reads TODAY'S OWN date as already past.
//
// `DATE_BEFORE` was written against exactly this trap and compares day-keys
// lexically instead (its own comment says so). `DATE_BEFORE_TODAY`,
// `DATE_AFTER_TODAY` and `DATE_IS_TODAY` are the neighbours that never got the
// treatment: three `case`s below one that had already been fixed.
//
// These tests pin the LOCAL-day semantics every user-visible date in this app
// uses. They are timezone-independent by construction: the fixtures are derived
// from the same local-day arithmetic `$today` uses, so the suite means the same
// thing in UTC (where the bug is invisible) as in CDT (where it bites).
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };

const TODAY = localDay(new Date());
const YESTERDAY = shift(-1);
const TOMORROW = shift(1);

const check = (left, comparator) => evalRule({ left: "$v", comparator, right: "" }, { $v: left });

describe("DATE_BEFORE_TODAY — local day, not UTC midnight", () => {
  // THE DISCRIMINATING CASE. This is the one that fails against the naive
  // parse in every timezone west of UTC, and it is the case the end-of-day
  // filing depends on: a task ticked TODAY must stay put until tomorrow.
  it("is FALSE for today's own date", () => {
    expect(check(TODAY, "DATE_BEFORE_TODAY")).toBe(false);
  });

  it("is TRUE for yesterday", () => {
    expect(check(YESTERDAY, "DATE_BEFORE_TODAY")).toBe(true);
  });

  it("is FALSE for tomorrow", () => {
    expect(check(TOMORROW, "DATE_BEFORE_TODAY")).toBe(false);
  });

  // Fails CLOSED. An unstamped row must never be swept up by a date rule —
  // "no value" is not "long ago".
  it("is FALSE for an empty or unparseable value", () => {
    expect(check("", "DATE_BEFORE_TODAY")).toBe(false);
    expect(check(null, "DATE_BEFORE_TODAY")).toBe(false);
    expect(check("not a date", "DATE_BEFORE_TODAY")).toBe(false);
  });

  // A full timestamp must agree with the bare day it falls on — otherwise the
  // same calendar day answers differently depending on how it was written.
  it("ignores the time of day", () => {
    expect(check(`${TODAY}T23:59:00.000Z`, "DATE_BEFORE_TODAY")).toBe(false);
    expect(check(`${YESTERDAY}T00:00:00.000Z`, "DATE_BEFORE_TODAY")).toBe(true);
  });
});

describe("DATE_IS_TODAY / DATE_AFTER_TODAY — the same neighbours", () => {
  it("DATE_IS_TODAY is TRUE for today and FALSE either side", () => {
    expect(check(TODAY, "DATE_IS_TODAY")).toBe(true);
    expect(check(YESTERDAY, "DATE_IS_TODAY")).toBe(false);
    expect(check(TOMORROW, "DATE_IS_TODAY")).toBe(false);
  });

  it("DATE_AFTER_TODAY is TRUE only for tomorrow onward", () => {
    expect(check(TOMORROW, "DATE_AFTER_TODAY")).toBe(true);
    expect(check(TODAY, "DATE_AFTER_TODAY")).toBe(false);
    expect(check(YESTERDAY, "DATE_AFTER_TODAY")).toBe(false);
  });

  // The three partition the timeline: exactly one is true for any given day.
  it("the three are mutually exclusive and total", () => {
    for (const d of [YESTERDAY, TODAY, TOMORROW]) {
      const hits = ["DATE_BEFORE_TODAY", "DATE_IS_TODAY", "DATE_AFTER_TODAY"]
        .filter((c) => check(d, c));
      expect(hits).toHaveLength(1);
    }
  });
});
