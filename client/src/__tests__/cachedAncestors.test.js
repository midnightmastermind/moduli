// The ancestor set of X does not depend on WHO is asking.
//
// `resolveFeedItems` memoised the walk PER CALL, so each of the grid's 37 feeds
// rebuilt the parents map and redid all 21,207 ancestor walks the previous feed
// had just done. Measured at live-grid scale (21,207 occurrences, 37 feeds):
//
//     buildParentsMap x37    449ms  ->    0ms   (the memoised twin already existed)
//     ancestor walk   x37    599ms  ->   33ms
//     resolveFeedItems      2956ms  -> 1782ms
//     the whole feedSync pass 3083ms -> 1955ms
//
// Its own comment already claimed "Memoised per map identity"; only the code
// disagreed — it called `buildParentsMap` while `cachedParentsMap` sat beside it.
//
// THE RISK IS STALENESS, not speed: identity-keyed caching is sound only while
// nothing mutates the map in place. Verified for all three callers — feedSync
// builds a fresh map per pass and never writes to it, and the two render-path
// callers read `useMemo(() => buildLookup(state.occurrences), [state.occurrences])`,
// which the reducer swaps on every write.
import { describe, it, expect } from "vitest";
import { cachedAncestorsOf } from "../helpers/dragHitTesting";

// Multi-parent on purpose: a task lives in its Tasks container AND in each
// day's Todo, which is why `reachableAncestors` exists at all.
const gridWhere = (childParent) => ({
  page:  { id: "page",  occurrences: ["tasks", "sched"] },
  tasks: { id: "tasks", occurrences: childParent === "tasks" ? ["kid"] : [] },
  sched: { id: "sched", occurrences: childParent === "sched" ? ["kid"] : [] },
  kid:   { id: "kid",   occurrences: [] },
});

describe("cachedAncestorsOf", () => {
  it("walks EVERY path, not one", () => {
    const g = gridWhere("tasks");
    g.sched.occurrences.push("kid");            // now reachable both ways
    const anc = cachedAncestorsOf(g)("kid");
    expect(anc).toContain("tasks");
    expect(anc).toContain("sched");
    expect(anc).toContain("page");
  });

  it("returns the SAME array for a repeat ask on the same map", () => {
    const g = gridWhere("tasks");
    const of = cachedAncestorsOf(g);
    expect(of("kid")).toBe(of("kid"));
  });

  it("shares the cache across separate calls on one map — the whole point", () => {
    // 37 feeds each call cachedAncestorsOf(occurrencesById); the second must
    // reuse the first's work rather than redo 21,207 walks.
    const g = gridWhere("tasks");
    expect(cachedAncestorsOf(g)("kid")).toBe(cachedAncestorsOf(g)("kid"));
  });

  it("RE-WALKS when the map is a new object — the invalidation that matters", () => {
    // The discriminating case. A cache keyed on something stable-but-wrong
    // would serve `tasks` here and silently give a feed the wrong rows.
    const before = cachedAncestorsOf(gridWhere("tasks"))("kid");
    const after = cachedAncestorsOf(gridWhere("sched"))("kid");
    expect(before).toContain("tasks");
    expect(before).not.toContain("sched");
    expect(after).toContain("sched");
    expect(after).not.toContain("tasks");
  });

  it("survives a missing or non-object map instead of throwing", () => {
    for (const bad of [null, undefined, 42, "nope"]) {
      expect(() => cachedAncestorsOf(bad)("kid")).not.toThrow();
    }
  });

  it("an occurrence with no parents reports none", () => {
    expect(cachedAncestorsOf(gridWhere("tasks"))("page")).toEqual([]);
  });
});
