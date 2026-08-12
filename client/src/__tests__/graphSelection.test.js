import { describe, it, expect } from "vitest";
import { selectedIdsForDay, derivesSelection } from "../helpers/graphSelection";

const MOOD = "f-mood";
const DATE = "f-date";
const opts = { valueFieldId: MOOD, dayFieldId: DATE, day: "2026-08-12" };

const occ = (id, day, moods, extra = {}) => ({
  id,
  fields: {
    ...(day ? { [DATE]: { value: day } } : {}),
    ...(moods !== undefined ? { [MOOD]: { value: moods } } : {}),
  },
  ...extra,
});

describe("selectedIdsForDay — the wheel reads the field", () => {
  it("collects the day's selection from the row that holds it", () => {
    const got = selectedIdsForDay([occ("journal", "2026-08-12", ["angry", "calm"])], opts);
    expect([...got]).toEqual(["angry", "calm"]);
  });

  it("UNIONS across every row dated that day — this is what makes a dragged row count", () => {
    // The journal holds the record; a Check In row holds one mood and its own
    // date. Both are dated today, so both contribute. Dragging the Check In
    // re-dates it, which is how a drag moves a mood with no mirror op.
    const got = selectedIdsForDay(
      [
        occ("journal", "2026-08-12", ["angry"]),
        occ("checkin-1", "2026-08-12", ["hopeful"]),
        occ("checkin-2", "2026-08-12", ["hopeful"]), // duplicate id, unioned away
      ],
      opts
    );
    expect([...got].sort()).toEqual(["angry", "hopeful"]);
  });

  it("ignores rows dated another day", () => {
    const got = selectedIdsForDay(
      [occ("today", "2026-08-12", ["angry"]), occ("yesterday", "2026-08-11", ["calm"])],
      opts
    );
    expect([...got]).toEqual(["angry"]);
  });

  it("matches a full ISO stamp against a bare day", () => {
    const got = selectedIdsForDay([occ("j", "2026-08-12T13:04:13.171Z", ["angry"])], opts);
    expect([...got]).toEqual(["angry"]);
  });

  it("accepts a single id as well as a list", () => {
    const got = selectedIdsForDay([occ("j", "2026-08-12", "angry")], opts);
    expect([...got]).toEqual(["angry"]);
  });

  it("SKIPS a feed copy — it carries its source's value on the wrong day", () => {
    const got = selectedIdsForDay(
      [
        occ("real", "2026-08-12", ["angry"]),
        occ("copy", "2026-08-12", ["fed"], { meta: { feedSourceId: "real" } }),
      ],
      opts
    );
    expect([...got]).toEqual(["angry"]);
  });

  it("returns an EMPTY set for a day with nothing — not null", () => {
    // The distinction is load-bearing: empty means "nothing selected today" and
    // must light nothing; null means "cannot derive" and falls back.
    const got = selectedIdsForDay([occ("j", "2026-08-11", ["calm"])], opts);
    expect(got).toBeInstanceOf(Set);
    expect(got.size).toBe(0);
  });

  it("returns NULL when it cannot derive at all", () => {
    expect(selectedIdsForDay([], { ...opts, day: null })).toBeNull();
    expect(selectedIdsForDay([], { ...opts, valueFieldId: null })).toBeNull();
    expect(selectedIdsForDay([], { ...opts, dayFieldId: null })).toBeNull();
  });

  it("survives junk rows without throwing", () => {
    const got = selectedIdsForDay(
      [null, {}, { fields: null }, occ("j", "2026-08-12", [null, "", 7, "angry"])],
      opts
    );
    expect([...got]).toEqual(["angry"]);
  });
});

describe("derivesSelection", () => {
  it("is true only when BOTH fields are configured", () => {
    expect(derivesSelection({ valueFieldId: MOOD, dayFieldId: DATE })).toBe(true);
    expect(derivesSelection({ valueFieldId: MOOD })).toBe(false);
    expect(derivesSelection({ dayFieldId: DATE })).toBe(false);
    expect(derivesSelection(null)).toBe(false);
  });
});
