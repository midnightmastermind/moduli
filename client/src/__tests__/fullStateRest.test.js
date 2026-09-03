// The additive half of the progressive load.
//
// The server now sends the working surfaces first (≈3MB) and the artifact
// catalogue right behind (≈16MB of a 28.74MB payload). This reducer case merges
// the second message in. It is STRICTLY ADDITIVE: a merge that overwrote could
// clobber a write made in the gap between the two messages — the stale-echo
// class this codebase has been damaged by repeatedly.
import { describe, it, expect } from "vitest";
import { masterReducer } from "../state/masterReducer";
import { ActionTypes } from "../state/actions";

const base = (over = {}) => ({
  occurrences: [{ id: "i1", moduleId: "mi" }],
  modules: [{ id: "mi", role: "instance" }],
  panels: [], containers: [], instances: [], artifacts: [], textblocks: [],
  ...over,
});
const rest = (payload) => ({ type: ActionTypes.FULL_STATE_REST, payload });

describe("FULL_STATE_REST", () => {
  it("appends the deferred artifacts and their modules", () => {
    const s = masterReducer(base(), rest({
      occurrences: [{ id: "a1", moduleId: "ma" }, { id: "a2", moduleId: "ma" }],
      modules: [{ id: "ma", role: "artifact" }],
    }));
    expect(s.occurrences.map(o => o.id)).toEqual(["i1", "a1", "a2"]);
    expect(s.modules.map(m => m.id)).toEqual(["mi", "ma"]);
    // the role arrays are derived from modules, so they must move with them
    expect(s.artifacts.map(m => m.id)).toEqual(["ma"]);
  });

  // THE ONE THAT MATTERS. A write landing between the two messages must survive
  // the merge untouched.
  it("never overwrites a record the store already holds", () => {
    const edited = { id: "i1", moduleId: "mi", fields: { f: { value: "typed while loading" } } };
    const s = masterReducer(base({ occurrences: [edited] }), rest({
      occurrences: [{ id: "i1", moduleId: "mi", fields: {} }, { id: "a1", moduleId: "ma" }],
      modules: [{ id: "mi", role: "instance" }],
    }));
    expect(s.occurrences.find(o => o.id === "i1")).toBe(edited);   // same object, untouched
    expect(s.occurrences.map(o => o.id)).toEqual(["i1", "a1"]);
  });

  // Identity matters: an unchanged state object means no re-render, and the
  // chunks arrive back to back.
  it("returns the SAME state when a chunk adds nothing", () => {
    const s0 = base();
    expect(masterReducer(s0, rest({ occurrences: [], modules: [] }))).toBe(s0);
    expect(masterReducer(s0, rest({}))).toBe(s0);
    expect(masterReducer(s0, rest({ occurrences: [{ id: "i1", moduleId: "mi" }] }))).toBe(s0);
  });

  it("merges several chunks in order without duplicating", () => {
    let s = base();
    s = masterReducer(s, rest({ occurrences: [{ id: "a1", moduleId: "ma" }], modules: [{ id: "ma", role: "artifact" }] }));
    s = masterReducer(s, rest({ occurrences: [{ id: "a2", moduleId: "ma" }], modules: [] }));
    s = masterReducer(s, rest({ occurrences: [{ id: "a2", moduleId: "ma" }], modules: [] }));  // a repeat
    expect(s.occurrences.map(o => o.id)).toEqual(["i1", "a1", "a2"]);
    expect(s.modules.map(m => m.id)).toEqual(["mi", "ma"]);
  });

  it("ignores records with no id rather than inserting junk", () => {
    const s = masterReducer(base(), rest({ occurrences: [{ moduleId: "ma" }, null], modules: [{ role: "artifact" }] }));
    expect(s.occurrences.map(o => o.id)).toEqual(["i1"]);
  });
});

// ── "the deferred half is still in flight" ──────────────────────────────────
//
// Between the two messages a board LISTS children that do not resolve, and it
// painted its EMPTY state for as long as the catalogue took. The flag is what
// lets a container tell "still loading" from "nothing here"; the count comes
// from the server, so it cannot disagree with the wire.
describe("awaitingDeferred", () => {
  const full = (payload) => ({ type: ActionTypes.FULL_STATE, payload });

  it("is set when the server held rows back", () => {
    const s = masterReducer(base(), full({ occurrences: [], modules: [], deferredCount: 15708 }));
    expect(s.awaitingDeferred).toBe(true);
  });

  it("is NOT set on a load with nothing deferred", () => {
    const s = masterReducer(base(), full({ occurrences: [], modules: [], deferredCount: 0 }));
    expect(s.awaitingDeferred).toBe(false);
  });

  it("clears when the catalogue lands", () => {
    const s = masterReducer(base({ awaitingDeferred: true }), rest({
      occurrences: [{ id: "a1", moduleId: "ma" }],
      modules: [{ id: "ma", role: "artifact" }],
    }));
    expect(s.awaitingDeferred).toBe(false);
  });

  // THE CASE THAT WOULD OTHERWISE HANG THE SPINNER. A final chunk carrying
  // nothing new still means the rest arrived — the early return has to clear
  // the flag rather than bail with it still set.
  it("clears even when the arriving chunk adds nothing new", () => {
    const s = masterReducer(base({ awaitingDeferred: true }), rest({ occurrences: [], modules: [] }));
    expect(s.awaitingDeferred).toBe(false);
  });

  it("returns the SAME state object for an empty chunk when not waiting", () => {
    const before = base();
    expect(masterReducer(before, rest({ occurrences: [], modules: [] }))).toBe(before);
  });
});
