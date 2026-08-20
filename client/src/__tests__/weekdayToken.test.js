// `weekday:expr` — the day of the week a date falls on.
//
// The weekday templates resolve by matching this against a template's own
// `Weekday` field, so an off-by-one here puts every Monday's schedule on
// Sunday — silently, and only on the machines whose timezone is behind UTC.
import { describe, it, expect } from "vitest";
import { resolveExpr } from "../helpers/operationActions";

describe("weekday:", () => {
  it("names the day a YYYY-MM-DD date falls on", () => {
    expect(resolveExpr("weekday:$d", { $d: "2026-08-20" })).toBe("Thursday");
    expect(resolveExpr("weekday:$d", { $d: "2026-08-24" })).toBe("Monday");
    expect(resolveExpr("weekday:$d", { $d: "2026-08-23" })).toBe("Sunday");
  });

  // THE CASE THE WHOLE FEATURE RESTS ON. `new Date("2026-08-24")` is UTC
  // midnight — 7pm Sunday in CDT — so a naive parse reports "Sunday" for
  // Monday and every weekday template lands one day early.
  it("parses as LOCAL midnight, not UTC", () => {
    const naive = new Date("2026-08-24").toLocaleDateString("en-US", { weekday: "long" });
    expect(resolveExpr("weekday:$d", { $d: "2026-08-24" })).toBe("Monday");
    if (new Date().getTimezoneOffset() > 0) expect(naive).toBe("Sunday");  // the control, west of UTC
  });

  it("reads a full timestamp too, and returns nothing for a non-date", () => {
    expect(resolveExpr("weekday:$d", { $d: "2026-08-20T14:30:00.000Z" })).toBeTruthy();
    expect(resolveExpr("weekday:$d", { $d: "" })).toBe("");
    expect(resolveExpr("weekday:$d", { $d: null })).toBe("");
    expect(resolveExpr("weekday:$d", { $d: "not a date" })).toBe("");
  });

  // dateLong shares the parse now — a regression there would move the weekday.
  it("agrees with dateLong, which carries the same weekday", () => {
    const long = resolveExpr("dateLong:$d", { $d: "2026-08-24" });
    expect(long.startsWith(resolveExpr("weekday:$d", { $d: "2026-08-24" }))).toBe(true);
    expect(long).toBe("Monday, August 24th, 2026");
  });
});
