// A DATE MOVE MUST BE VISIBLE TO THE NEXT OP IN THE SAME SWEEP.
//
// `Grid: Snap Filter To Today` (trigger priority 0) moves each page's own date
// on the first load of a new day. `Schedule: Build Schedule` (priority 1) runs
// moments later in the SAME `runMatchingOperations` batch and takes its dates
// from its target page's effective filter. Those two only agree if the snap's
// write lands in the in-batch overlay.
//
// It did not: `UPDATE_ITEM_FILTER_OVERRIDE` had no case in
// `applyEffectsToLiveOccs` and was missing from `_LIVEOCCS_MUTATING`, so the
// build read YESTERDAY's date, found yesterday's column already there, and
// created nothing. Today's schedule then did not appear until the NEXT load.
import { describe, it, expect } from "vitest";
import { applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

const DATE_FIELD = "Eh7oi4HKdbHB";
const PAGE = "schedPage";

const overlay = (override) => ({
  [PAGE]: { id: PAGE, moduleId: "m1", role: "page", parentId: null, occurrences: [], filterOverride: override },
});

describe("UPDATE_ITEM_FILTER_OVERRIDE reaches the in-batch overlay", () => {
  it("THE ONE THAT MATTERS: a later op reads the NEW date, not the stale one", () => {
    const live = overlay({ [DATE_FIELD]: "2026-08-17" });
    applyEffectsToLiveOccs(live, [
      { _effect: "UPDATE_ITEM_FILTER_OVERRIDE", itemId: PAGE, fieldId: DATE_FIELD, value: "2026-08-18" },
    ]);
    // This is the exact read `$activePeriodDates` performs for an op whose
    // targetOccurrenceId is the Schedule page.
    const eff = getEffectiveFilterForOccurrence(live[PAGE], {
      grid: { activeFilterValues: { [DATE_FIELD]: "2026-08-09" } },
      occurrencesById: live,
    });
    expect(eff[DATE_FIELD]).toBe("2026-08-18");
  });

  it("reports the batch as mutated, so the enriched read model is rebuilt", () => {
    const live = overlay({ [DATE_FIELD]: "2026-08-17" });
    const mutated = applyEffectsToLiveOccs(live, [
      { _effect: "UPDATE_ITEM_FILTER_OVERRIDE", itemId: PAGE, fieldId: DATE_FIELD, value: "2026-08-18" },
    ]);
    // A filter override changes every DESCENDANT's effective filter, so it is
    // not a value-only write and the cache must not survive it.
    expect(mutated).toBe(true);
  });

  it("a null value CLEARS the key rather than storing null", () => {
    const live = overlay({ [DATE_FIELD]: "2026-08-17", other: "x" });
    applyEffectsToLiveOccs(live, [
      { _effect: "UPDATE_ITEM_FILTER_OVERRIDE", itemId: PAGE, fieldId: DATE_FIELD, value: null },
    ]);
    expect(DATE_FIELD in live[PAGE].filterOverride).toBe(false);
    expect(live[PAGE].filterOverride.other).toBe("x");
  });

  it("creates the map when the page had no override at all", () => {
    const live = overlay(null);
    applyEffectsToLiveOccs(live, [
      { _effect: "UPDATE_ITEM_FILTER_OVERRIDE", itemId: PAGE, fieldId: DATE_FIELD, value: "2026-08-18" },
    ]);
    expect(live[PAGE].filterOverride[DATE_FIELD]).toBe("2026-08-18");
  });

  it("does not invent an entry for an occurrence the overlay has never seen", () => {
    const live = overlay({ [DATE_FIELD]: "2026-08-17" });
    applyEffectsToLiveOccs(live, [
      { _effect: "UPDATE_ITEM_FILTER_OVERRIDE", itemId: "ghost", fieldId: DATE_FIELD, value: "2026-08-18" },
    ]);
    expect(live.ghost).toBeUndefined();
  });
});
