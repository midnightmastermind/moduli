// Built-in date tokens in a FEED condition's value.
//
// User, 2026-08-07: "include appointments there too after the date passes for
// it." An appointment stops being upcoming when its DATE HAS PASSED — not when
// it is completed — so the Completed container's feed needs to express
// `Date DATE_BEFORE <today>`.
//
// It could not. `resolveFeedItems` builds each rule as
// `{ left, comparator, right: cond.value }` and hands it to
// `evalRuleAgainstRecord(rule, record, {})` — an EMPTY `$vars` — so `$today`
// resolved to nothing. A literal date typed into the config goes stale the
// next day, which is worse than not shipping it.
//
// The escape hatch of leaving the value empty (falling back to the owner's
// effective filter) is dead on the Tasks page specifically: it carries
// `filterOverride: {}`, the opt-out-of-date-filtering marker, so the cascade
// deletes the date key and the condition is SKIPPED — matching EVERY
// appointment regardless of date. Silently wrong.
//
// SAFETY, MEASURED BEFORE WRITING THIS: across all three grids there are 71
// feed conditions and NOT ONE has a value beginning with "$" (35 strings + 1
// boolean per grid, all CONTAINS/IS). A resolver gated on a leading "$"
// therefore cannot change what any existing feed matches.

import { describe, it, expect } from "vitest";
import { resolveFeedConditionValue } from "../helpers/feedTokens.js";

describe("resolveFeedConditionValue — $today", () => {
  it("resolves $today to the day key of the supplied clock", () => {
    const now = new Date(2026, 7, 8, 12, 0, 0); // 2026-08-08, midday local
    expect(resolveFeedConditionValue("$today", now)).toBe("2026-08-08");
  });

  // These two cases together discriminate against `toISOString().slice(0,10)`
  // in ANY timezone but UTC itself: the late-evening case fails west of UTC,
  // the early-morning case fails east of it. This repo has lost a day to that
  // exact bug more than once.
  it("reads LOCAL parts late in the evening", () => {
    const now = new Date(2026, 7, 8, 23, 59, 59);
    expect(resolveFeedConditionValue("$today", now)).toBe("2026-08-08");
  });

  it("reads LOCAL parts early in the morning", () => {
    const now = new Date(2026, 7, 8, 0, 0, 1);
    expect(resolveFeedConditionValue("$today", now)).toBe("2026-08-08");
  });

  it("tolerates surrounding whitespace from a config box", () => {
    const now = new Date(2026, 7, 8, 12, 0, 0);
    expect(resolveFeedConditionValue("  $today  ", now)).toBe("2026-08-08");
  });
});

describe("resolveFeedConditionValue — everything else passes through untouched", () => {
  const now = new Date(2026, 7, 8, 12, 0, 0);

  // The shape of all 35 string conditions on the live grids.
  it("passes an ordinary string through unchanged", () => {
    expect(resolveFeedConditionValue("grocery", now)).toBe("grocery");
  });

  // The one boolean condition on the live grids (Completed IS true).
  it("passes a boolean through unchanged", () => {
    expect(resolveFeedConditionValue(true, now)).toBe(true);
    expect(resolveFeedConditionValue(false, now)).toBe(false);
  });

  it("passes null and undefined through unchanged", () => {
    expect(resolveFeedConditionValue(null, now)).toBe(null);
    expect(resolveFeedConditionValue(undefined, now)).toBe(undefined);
  });

  it("passes arrays and objects through unchanged", () => {
    const arr = ["a", "b"];
    const obj = { value: "2026-08-08", unit: "day" };
    expect(resolveFeedConditionValue(arr, now)).toBe(arr);
    expect(resolveFeedConditionValue(obj, now)).toBe(obj);
  });

  it("passes a number through unchanged", () => {
    expect(resolveFeedConditionValue(42, now)).toBe(42);
  });

  // A string that merely CONTAINS a dollar sign is not a token — a price tag
  // must not be rewritten.
  it("passes a string with a non-leading $ through unchanged", () => {
    expect(resolveFeedConditionValue("costs $5", now)).toBe("costs $5");
  });

  // Fails CLOSED by passing through: an unresolvable right-hand side makes
  // DATE_BEFORE return false rather than matching everything.
  it("passes an unknown $token through unchanged", () => {
    expect(resolveFeedConditionValue("$todya", now)).toBe("$todya");
    expect(resolveFeedConditionValue("$activeDate", now)).toBe("$activeDate");
  });
});
