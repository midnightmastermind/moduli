import { describe, it, expect } from "vitest";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

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

  it("guards against circular parentId references", () => {
    const state = makeState([
      { id: "a", parentId: "b", filterOverride: null },
      { id: "b", parentId: "a", filterOverride: null },
    ]);
    expect(() => getEffectiveFilterForOccurrence(state.occurrencesById.a, state)).not.toThrow();
  });
});
