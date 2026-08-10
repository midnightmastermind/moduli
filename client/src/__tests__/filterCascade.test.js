import { describe, it, expect } from "vitest";
import { getEffectiveFilterForOccurrence, isOccurrenceVisible } from "../state/selectors";

const grid = { activeFilterValues: { scheduledDate: "2026-04-18" } };

const makeState = (occs) => ({
  grid,
  occurrencesById: Object.fromEntries(occs.map(o => [o.id, o])),
});

describe("getEffectiveFilterForOccurrence", () => {
  it("inherits grid values when the whole chain is filterOverride:null", () => {
    const state = makeState([
      { id: "a", parentId: null, filterOverride: null },
      { id: "b", parentId: "a", filterOverride: null },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.b, state))
      .toEqual({ scheduledDate: "2026-04-18" });
  });

  it("empty object at any level breaks inheritance (unlocked — show everything)", () => {
    const state = makeState([
      { id: "a", parentId: null, filterOverride: {} },
      { id: "b", parentId: "a", filterOverride: null },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.b, state))
      .toEqual({});
  });

  it("specific values override inherited ones by field", () => {
    const state = makeState([
      { id: "a", parentId: null, filterOverride: null },
      { id: "b", parentId: "a", filterOverride: { scheduledDate: "2026-04-20" } },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.b, state))
      .toEqual({ scheduledDate: "2026-04-20" });
  });

  it("returns grid values when passed null occurrence", () => {
    const state = makeState([]);
    expect(getEffectiveFilterForOccurrence(null, state))
      .toEqual({ scheduledDate: "2026-04-18" });
  });

  it("deep chain: override at root applies to all descendants", () => {
    const state = makeState([
      { id: "panel", parentId: null, filterOverride: { scheduledDate: "2026-04-15" } },
      { id: "container", parentId: "panel", filterOverride: null },
      { id: "instance", parentId: "container", filterOverride: null },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.instance, state))
      .toEqual({ scheduledDate: "2026-04-15" });
  });

  it("child override wins over ancestor override", () => {
    const state = makeState([
      { id: "panel", parentId: null, filterOverride: { scheduledDate: "2026-04-15" } },
      { id: "container", parentId: "panel", filterOverride: { scheduledDate: "2026-04-20" } },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.container, state))
      .toEqual({ scheduledDate: "2026-04-20" });
  });

  it("resolves ancestor filter via occurrences[] when parentId is unset (goal-tracker bug)", () => {
    // Repro of the 2026-05-15 bug: goal display instance → Physical goal
    // container → Daily Goals page. Only the leaf instance has parentId; the
    // container and page link children via occurrences[] (no parentId). A
    // parentId-only walk stops at the container and never sees the page's
    // filterOverride. The occurrences[]-derived reverse map must resolve it.
    const state = makeState([
      { id: "page",      parentId: null, filterOverride: { scheduledDate: "2026-04-22" }, occurrences: ["cont"] },
      { id: "cont",      parentId: null, filterOverride: null,                            occurrences: ["goalInst"] },
      { id: "goalInst",  parentId: "cont", filterOverride: null },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.goalInst, state))
      .toEqual({ scheduledDate: "2026-04-22" });
  });

  it("filter set on the mid-level container (no parentId) reaches the leaf instance", () => {
    // User sets the Date filter on the Physical container itself.
    const state = makeState([
      { id: "page",      parentId: null, filterOverride: null,                            occurrences: ["cont"] },
      { id: "cont",      parentId: null, filterOverride: { scheduledDate: "2026-04-23" }, occurrences: ["goalInst"] },
      { id: "goalInst",  parentId: "cont", filterOverride: null },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.goalInst, state))
      .toEqual({ scheduledDate: "2026-04-23" });
  });

  it("guards against circular parentId references", () => {
    const state = makeState([
      { id: "a", parentId: "b", filterOverride: null },
      { id: "b", parentId: "a", filterOverride: null },
    ]);
    expect(() => getEffectiveFilterForOccurrence(state.occurrencesById.a, state)).not.toThrow();
  });

  // ── Null-mute scoping (ancestor's mute is local-only unless they own it) ──
  it("ancestor null override on an INHERITED filter mutes only that ancestor — descendants still inherit from grid", () => {
    // Grid declares the Date filter. Panel doesn't carry a local `filters[]`
    // entry for Date — so Panel's `filterOverride: { scheduledDate: null }`
    // is muting an inherited filter. The mute should apply to Panel's own
    // visibility but NOT cascade to the container below.
    const state = makeState([
      { id: "panel",     parentId: null,     filterOverride: { scheduledDate: null }, filters: [] },
      { id: "container", parentId: "panel",  filterOverride: null,                    filters: [] },
    ]);
    // Panel's own effective filter has Date muted.
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.panel, state))
      .toEqual({});
    // Container's effective filter ignores Panel's null — Date still applies.
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.container, state))
      .toEqual({ scheduledDate: "2026-04-18" });
  });

  it("ancestor null override on a LOCAL filter (declared in filters[]) cascades to descendants", () => {
    // Panel declares Date in its own `filters[]`, so muting it via
    // filterOverride says "I'm turning off MY filter for me + everyone below".
    const state = makeState([
      {
        id: "panel",
        parentId: null,
        filterOverride: { scheduledDate: null },
        filters: [{ id: "f1", fieldId: "scheduledDate", active: true }],
      },
      { id: "container", parentId: "panel", filterOverride: null, filters: [] },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.panel, state))
      .toEqual({});
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.container, state))
      .toEqual({});
  });

  it("leaf's own null override always mutes the leaf's effective filter", () => {
    // Even if Container doesn't own the local Date filter, muting on itself
    // applies to itself (leaf nulls always count).
    const state = makeState([
      { id: "panel",     parentId: null,    filterOverride: null,                    filters: [] },
      { id: "container", parentId: "panel", filterOverride: { scheduledDate: null }, filters: [] },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.container, state))
      .toEqual({});
  });

  it("null mute skips generations: grandparent owns the filter, parent's inherited-mute doesn't cascade", () => {
    // Grandparent (page) declares Date locally + sets a value.
    // Panel (parent) mutes Date but doesn't own a local Date filter.
    // Container (leaf) should inherit Date from grandparent — Panel's null
    // is skipped because Panel doesn't own the filter.
    const state = makeState([
      {
        id: "page",
        parentId: null,
        filterOverride: { scheduledDate: "2026-04-20" },
        filters: [{ id: "f1", fieldId: "scheduledDate", active: true }],
      },
      { id: "panel",     parentId: "page",  filterOverride: { scheduledDate: null }, filters: [] },
      { id: "container", parentId: "panel", filterOverride: null,                    filters: [] },
    ]);
    expect(getEffectiveFilterForOccurrence(state.occurrencesById.container, state))
      .toEqual({ scheduledDate: "2026-04-20" });
  });
});

// ─── Regression: Build-Day-style routine instance hidden by Schedule's date ──
// Scenario the user reported: Schedule's local filter is on May 15. User
// navigates Daily Goals to May 16 → Build Day fires (Goals trigger) and
// APPLY_TEMPLATEs routine instances dated May 16 under Schedule's slot
// containers. Schedule should hide the May 16 instances; the user observed
// they were showing alongside May 15. This test pins down the cascade +
// visibility pair so the bug can't regress silently.
describe("Schedule-cascaded date filter hides cross-day routine instances", () => {
  const buildScene = ({ scheduleDate, instanceDate }) => {
    const grid = { activeFilterValues: {} };
    const occurrencesById = {
      schedPage: {
        id: "schedPage", parentId: null,
        occurrences: ["slot6am"],
        filterOverride: { scheduledDate: scheduleDate },
      },
      slot6am: {
        id: "slot6am", parentId: "schedPage",
        occurrences: ["routineDrinkWater"],
        filterOverride: null,
      },
      routineDrinkWater: {
        id: "routineDrinkWater", parentId: "slot6am",
        // Shape mirrors APPLY_TEMPLATE's resolvedDefaultFields output:
        // { [fid]: { value, flow: "in" } }.
        fields: { scheduledDate: { value: instanceDate, flow: "in" } },
        filterOverride: null,
      },
    };
    return { grid, occurrencesById };
  };

  const dailyFilterConditions = [
    { fieldId: "scheduledDate", comparator: "SAME_DAY", isNav: true },
  ];

  it("hides a routine instance dated to a different day than Schedule's filter", () => {
    const state = buildScene({ scheduleDate: "2026-05-15", instanceDate: "2026-05-16" });
    const slot = state.occurrencesById.slot6am;
    const inst = state.occurrencesById.routineDrinkWater;
    const slotEffective = getEffectiveFilterForOccurrence(slot, state);
    expect(slotEffective).toEqual({ scheduledDate: "2026-05-15" });
    expect(isOccurrenceVisible(inst, slotEffective, dailyFilterConditions)).toBe(false);
  });

  it("shows a routine instance whose date matches Schedule's filter", () => {
    const state = buildScene({ scheduleDate: "2026-05-15", instanceDate: "2026-05-15" });
    const slot = state.occurrencesById.slot6am;
    const inst = state.occurrencesById.routineDrinkWater;
    const slotEffective = getEffectiveFilterForOccurrence(slot, state);
    expect(isOccurrenceVisible(inst, slotEffective, dailyFilterConditions)).toBe(true);
  });

  it("hides instances when Schedule's filter is on tomorrow but the instance dates to today", () => {
    const state = buildScene({ scheduleDate: "2026-05-16", instanceDate: "2026-05-15" });
    const slot = state.occurrencesById.slot6am;
    const inst = state.occurrencesById.routineDrinkWater;
    const slotEffective = getEffectiveFilterForOccurrence(slot, state);
    expect(isOccurrenceVisible(inst, slotEffective, dailyFilterConditions)).toBe(false);
  });

  // Critical regression — the actual runtime bug the user hit. The visible
  // failure mode is "Schedule shows tasks for both May 15 and May 16 even
  // though Schedule's filter widget claims May 15". The `[VIS-DIAG]` log
  // showed `effectiveFilters: {}` and `conditionRightVal: undefined` —
  // meaning the filter cascade had no value to compare against, so every
  // dated instance passed through. Root cause: bindSocketToStore initialized
  // `state.filterNavState` (what the nav widget displays) from defaultNavValue,
  // but never wrote those defaults into `grid.activeFilterValues` (what
  // isOccurrenceVisible reads via the cascade). Until the user clicked an
  // arrow, no real filter value existed. Fix in bindSocketToStore.onFullState
  // bootstraps activeFilterValues for nav-driven grid filters.
  // Drilldown picker emits {kind:"multi", dates:[...]} when the user picks
  // non-consecutive days. The cascade must route those through
  // DATE_IN_PERIOD (NOT bare SAME_DAY) and OR-match across the array.
  // 2026-08-10 REGRESSION. The picker emits {value, unit:"day", kind:"single"}
  // for a SINGLE day — an OBJECT, not a bare string. The period detection used
  // to enumerate shapes (unit!=="day" || span>1 || kind==="multi"), which this
  // matches none of, so it fell back to SAME_DAY and compared a string to an
  // object. Every Schedule day column went invisible the moment a multi-day
  // range was narrowed to one day, while the data stayed intact.
  describe("single-day OBJECT filter shape (the narrow-to-one-day case)", () => {
    const col = (date) => ({
      id: "daycol", parentId: "schedPage",
      fields: { scheduledDate: { value: date, flow: "in" } },
    });
    const singleFilter = {
      scheduledDate: { value: "2026-08-10", unit: "day", kind: "single" },
    };

    it("shows the column whose date matches the single selected day", () => {
      expect(isOccurrenceVisible(col("2026-08-10"), singleFilter, dailyFilterConditions)).toBe(true);
    });

    it("hides a column on a different day", () => {
      expect(isOccurrenceVisible(col("2026-08-11"), singleFilter, dailyFilterConditions)).toBe(false);
    });

    it("works with no `kind` at all — {value, unit:'day'} is the same single day", () => {
      const bare = { scheduledDate: { value: "2026-08-10", unit: "day" } };
      expect(isOccurrenceVisible(col("2026-08-10"), bare, dailyFilterConditions)).toBe(true);
      expect(isOccurrenceVisible(col("2026-08-09"), bare, dailyFilterConditions)).toBe(false);
    });
  });

  describe("multi-date filter shape (drilldown picker)", () => {
    const inst = (date) => ({
      id: "x", parentId: "slot",
      fields: { scheduledDate: { value: date, flow: "in" } },
    });
    const multiFilter = {
      scheduledDate: {
        kind: "multi", unit: "day", value: "2026-05-13",
        dates: ["2026-05-13", "2026-05-17", "2026-05-21"],
      },
    };

    it("shows an instance whose date matches any selected day", () => {
      expect(isOccurrenceVisible(inst("2026-05-13"), multiFilter, dailyFilterConditions)).toBe(true);
      expect(isOccurrenceVisible(inst("2026-05-17"), multiFilter, dailyFilterConditions)).toBe(true);
      expect(isOccurrenceVisible(inst("2026-05-21"), multiFilter, dailyFilterConditions)).toBe(true);
    });

    it("hides an instance whose date isn't in the selected set", () => {
      expect(isOccurrenceVisible(inst("2026-05-14"), multiFilter, dailyFilterConditions)).toBe(false);
      expect(isOccurrenceVisible(inst("2026-05-20"), multiFilter, dailyFilterConditions)).toBe(false);
    });

    it("works on the legacy direct-equality path (no conditions array)", () => {
      // The other code path — when no `filterConditions` is passed, the
      // function falls back to direct field/value matching against
      // effectiveFilters. Multi-shape must still route through
      // DATE_IN_PERIOD here, not stringify to "[object Object]".
      expect(isOccurrenceVisible(inst("2026-05-17"), multiFilter)).toBe(true);
      expect(isOccurrenceVisible(inst("2026-05-20"), multiFilter)).toBe(false);
    });
  });

  // Consecutive multi-day picks emit kind:"range", unit:"day", span:N — a
  // period shape that previously fell back to SAME_DAY because the
  // `hasPeriod` detection only flagged unit !== "day" / kind === "multi".
  // SAME_DAY's dayKey(object) returns null, so every day-col failed the
  // visibility check and the Schedule page rendered empty for two-day
  // filters. The fix extends hasPeriod to also recognise span > 1.
  describe("range filter shape (consecutive multi-day picks)", () => {
    const inst = (date) => ({
      id: "x", parentId: "slot",
      fields: { scheduledDate: { value: date, flow: "in" } },
    });
    const rangeFilter = {
      scheduledDate: {
        kind: "range", unit: "day", value: "2026-05-13", span: 3,
        dates: ["2026-05-13", "2026-05-14", "2026-05-15"],
      },
    };
    it("shows instances whose date falls inside the range", () => {
      expect(isOccurrenceVisible(inst("2026-05-13"), rangeFilter, dailyFilterConditions)).toBe(true);
      expect(isOccurrenceVisible(inst("2026-05-14"), rangeFilter, dailyFilterConditions)).toBe(true);
      expect(isOccurrenceVisible(inst("2026-05-15"), rangeFilter, dailyFilterConditions)).toBe(true);
    });
    it("hides instances outside the range", () => {
      expect(isOccurrenceVisible(inst("2026-05-12"), rangeFilter, dailyFilterConditions)).toBe(false);
      expect(isOccurrenceVisible(inst("2026-05-16"), rangeFilter, dailyFilterConditions)).toBe(false);
    });
  });

  it("undefined filter rightVal makes isOccurrenceVisible pass everything (the bug)", () => {
    const noFilterState = {
      grid: { activeFilterValues: {} },
      occurrencesById: {
        schedPage: { id: "schedPage", parentId: null, filterOverride: null },
        slot: { id: "slot", parentId: "schedPage", filterOverride: null },
        inst: { id: "inst", parentId: "slot", fields: { scheduledDate: { value: "2026-05-99-WHATEVER", flow: "in" } } },
      },
    };
    const slot = noFilterState.occurrencesById.slot;
    const inst = noFilterState.occurrencesById.inst;
    const slotEffective = getEffectiveFilterForOccurrence(slot, noFilterState);
    expect(slotEffective).toEqual({});
    // Bug surface: cascade has no scheduledDate; rightVal is undefined; the
    // condition's `if (rightVal == null) continue;` skips the check entirely.
    // So the instance is "shown" regardless of its date value. This is the
    // expected isOccurrenceVisible behavior — the fix lives upstream in
    // bindSocketToStore (bootstrap activeFilterValues on full_state).
    expect(isOccurrenceVisible(inst, slotEffective, dailyFilterConditions)).toBe(true);
  });
});
