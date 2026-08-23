// The narrow widening of `sweepOrphans`' child guard: not "has children" but
// "would deleting it strand any". Calibrated on a real case — two dead day
// columns that list the same shared child ten healthy columns also list.
import { describe, it, expect } from "vitest";
import { strandableChildren, buildParentsByChild } from "../utils/strandableChildren.js";

const occ = (id, kids = []) => ({ id, occurrences: kids });

describe("strandableChildren", () => {
  it("reports NOTHING when every child is listed elsewhere", () => {
    // The live case: a dead day column listing the shared child that ten
    // healthy columns also list.
    const all = [occ("dead", ["shared"]), occ("healthy", ["shared"]), occ("shared")];
    expect(strandableChildren(all[0], buildParentsByChild(all))).toEqual([]);
  });

  it("reports a child NOTHING else lists — the case that must still refuse", () => {
    const all = [occ("dead", ["only-mine"]), occ("shared")];
    expect(strandableChildren(all[0], buildParentsByChild(all))).toEqual(["only-mine"]);
  });

  it("reports only the strandable ones out of a mixed list", () => {
    const all = [occ("dead", ["shared", "only-mine"]), occ("healthy", ["shared"])];
    expect(strandableChildren(all[0], buildParentsByChild(all))).toEqual(["only-mine"]);
  });

  it("does not count the row's OWN listing as another home", () => {
    // Otherwise every row would look safe: it always lists its own children.
    const all = [occ("dead", ["kid"])];
    expect(strandableChildren(all[0], buildParentsByChild(all))).toEqual(["kid"]);
  });

  it("a DUPLICATE self-listing is still not another home", () => {
    // `0198` repaired real rows listing one child twice; two self-listings must
    // not read as "someone else has it".
    const all = [occ("dead", ["kid", "kid"])];
    expect(strandableChildren(all[0], buildParentsByChild(all))).toEqual(["kid", "kid"]);
  });

  it("a childless row strands nothing", () => {
    expect(strandableChildren(occ("dead"), buildParentsByChild([occ("dead")]))).toEqual([]);
    expect(strandableChildren({}, new Map())).toEqual([]);
    expect(strandableChildren(null, new Map())).toEqual([]);
  });

  it("survives a missing index rather than throwing mid-sweep", () => {
    expect(strandableChildren(occ("d", ["k"]), undefined)).toEqual(["k"]);
  });
});
