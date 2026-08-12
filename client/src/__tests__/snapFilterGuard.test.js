// "Grid: Snap Filter To Today" moves every date-carrying page forward on the
// first load of a new day. Its guard is a PREDICATE evaluated by the real
// `evalRule`, so the only honest way to design a change to it is to drive that
// evaluator over the shapes a page actually stores.
//
// Measured on poms grid, 2026-08-11 — three shapes are live right now:
//
//   Trackers   "2026-08-10"                                        bare string
//   Schedule   {value:"2026-08-10", unit:"day", span:2, kind:"range"}   a range
//   Day Page   {value:null, unit:"day", kind:"single"}            CLEARED
//
// The first two must move forward. The third must NOT: clearing a date is a
// deliberate "show me nothing dated" (2026-08-11), and stamping today onto it
// overnight would silently undo the user's choice the next morning.
import { describe, it, expect } from "vitest";
import { evalRule, evalGroup } from "../helpers/operationActions";

const FID = "dateFid";
const page = (override) => ({ $pg: { filterOverride: { [FID]: override } } });

const BARE = "2026-08-10";
const RANGE = { value: "2026-08-10", unit: "day", span: 2, kind: "range" };
const CLEARED = { value: null, unit: "day", kind: "single" };
const SINGLE_OBJ = { value: "2026-08-10", unit: "day", kind: "single" };

// The guard as it ships today.
const OLD_GUARD = { operator: "AND", rules: [
  { id: "a", left: `$pg.filterOverride.${FID}`, comparator: "IS_NOT_EMPTY", right: "" },
]};

// The guard this change installs: still "carries its own date", but a period
// object whose value is null is a CLEAR, not a date.
//
// The second arm is what keeps a BARE STRING passing — a string has no `.unit`,
// so `unit IS_EMPTY` is true for it and false for every period object. Without
// that arm, requiring `.value` would skip the Trackers page entirely.
const NEW_GUARD = { operator: "AND", rules: [
  { id: "a", left: `$pg.filterOverride.${FID}`, comparator: "IS_NOT_EMPTY", right: "" },
  { id: "b", operator: "OR", rules: [
    { id: "b1", left: `$pg.filterOverride.${FID}.value`, comparator: "IS_NOT_EMPTY", right: "" },
    { id: "b2", left: `$pg.filterOverride.${FID}.unit`, comparator: "IS_EMPTY", right: "" },
  ]},
]};

describe("IS_NOT_EMPTY on the shapes a filterOverride actually holds", () => {
  const notEmpty = (v) => evalRule(
    { left: `$pg.filterOverride.${FID}`, comparator: "IS_NOT_EMPTY", right: "" }, page(v),
  );

  // This is why a range already collapses: the op overwrites the whole value
  // with a bare `$today`, and an OBJECT passes the guard that lets it.
  it("an object is NOT empty — so a range is moved forward, whole", () => {
    expect(notEmpty(RANGE)).toBe(true);
  });

  it("a bare date string is not empty", () => {
    expect(notEmpty(BARE)).toBe(true);
  });

  // The problem. A cleared page looks exactly like a dated one to this rule.
  it("a CLEARED period is also 'not empty' — which is the defect", () => {
    expect(notEmpty(CLEARED)).toBe(true);
  });

  it("an absent override is empty", () => {
    expect(notEmpty(undefined)).toBe(false);
    expect(notEmpty(null)).toBe(false);
  });
});

describe("the old guard moves a CLEARED page forward (the regression)", () => {
  it("passes every shape, including the cleared one", () => {
    expect(evalGroup(OLD_GUARD, page(BARE))).toBe(true);
    expect(evalGroup(OLD_GUARD, page(RANGE))).toBe(true);
    expect(evalGroup(OLD_GUARD, page(CLEARED))).toBe(true);   // ← undoes the clear
  });
});

describe("the new guard: still moves dates, never revives a cleared one", () => {
  it("moves a bare-string date forward", () => {
    expect(evalGroup(NEW_GUARD, page(BARE))).toBe(true);
  });

  it("moves a RANGE forward — collapsing it, since $today replaces the object", () => {
    expect(evalGroup(NEW_GUARD, page(RANGE))).toBe(true);
  });

  it("moves a single-day OBJECT forward", () => {
    expect(evalGroup(NEW_GUARD, page(SINGLE_OBJ))).toBe(true);
  });

  // THE ONE THAT MATTERS.
  it("SKIPS a page whose date was explicitly cleared", () => {
    expect(evalGroup(NEW_GUARD, page(CLEARED))).toBe(false);
  });

  it("still skips a page carrying no override at all", () => {
    expect(evalGroup(NEW_GUARD, page(undefined))).toBe(false);
    expect(evalGroup(NEW_GUARD, { $pg: { filterOverride: {} } })).toBe(false);
  });

  // A non-consecutive multi-pick can carry a null anchor while naming real
  // days. That is a selection, and it must keep moving forward.
  it("moves a multi-pick with a null anchor but real dates forward", () => {
    const multi = { value: null, unit: "day", kind: "multi", dates: ["2026-08-10"] };
    // `.value` is empty and `.unit` is set, so the OR alone would skip it —
    // hence the explicit dates arm below. Pinned here so the shape is not
    // forgotten if the guard is ever rebuilt.
    const withDates = { operator: "AND", rules: [
      NEW_GUARD.rules[0],
      { id: "b", operator: "OR", rules: [
        ...NEW_GUARD.rules[1].rules,
        { id: "b3", left: `$pg.filterOverride.${FID}.dates`, comparator: "IS_NOT_EMPTY", right: "" },
      ]},
    ]};
    expect(evalGroup(withDates, page(multi))).toBe(true);
    expect(evalGroup(withDates, page(CLEARED))).toBe(false);
  });
});
