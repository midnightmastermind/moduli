// A stale write may ADD children, never DROP them.
//
// THE FAILURE THIS PREVENTS, observed twice on live data (2026-08-13,
// 2026-08-17): a client holds the `occurrences[]` array `full_state` gave it,
// something else adds a child, and the client's next write echoes its pre-add
// copy back. Nothing is deleted — the child is alive and still names the parent
// in its own `parentId` — but a parent RENDERS `occurrences[]`, so it is
// invisible. On 2026-08-17 that cost a whole day's schedule: the column was
// built with 52 children and the page's array was overwritten three
// MILLISECONDS later.
//
// The existing stale check could not catch it: it is waived for SELF-SUCCESSION
// (one socket writing twice), which is exactly this clobber's shape.
import { describe, it, expect } from "vitest";
import { mergeStaleChildArray } from "../socketHandlers/occurrences.js";

const KNOWN = new Set(["a", "b", "c", "newborn"]);
const isKnown = (id) => KNOWN.has(id);
const STALE = [1000, 2000];   // basis older than stored  -> provably stale
const CURRENT = [2000, 2000]; // basis matches stored     -> provably current

describe("mergeStaleChildArray", () => {
  it("THE ONE THAT MATTERS: a stale write cannot drop a live child", () => {
    // Client saw [a, b]; the build added `newborn`; the client echoes [a, b].
    const out = mergeStaleChildArray(["a", "b"], ["a", "b", "newborn"], ...STALE, isKnown);
    expect(out).toEqual(["a", "b", "newborn"]);
  });

  it("a CURRENT write removes exactly what it meant to", () => {
    // This is the half that keeps REMOVE_CHILD and the drag paths working —
    // they go through CommitHelpers, which sends a current expectedUpdatedAt.
    const out = mergeStaleChildArray(["a"], ["a", "b"], ...CURRENT, isKnown);
    expect(out).toEqual(["a"]);
  });

  it("a stale write may still ADD — it is additive, not frozen", () => {
    const out = mergeStaleChildArray(["a", "b", "c"], ["a", "b"], ...STALE, isKnown);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("keeps PREV order, so a day column does not come back rotated", () => {
    // Appending survivors would put 12:00am after 4:00am — the exact rotation
    // migration 0137 had to repair.
    const out = mergeStaleChildArray(["c"], ["a", "b", "c"], ...STALE, isKnown);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("does not resurrect a child that no longer exists", () => {
    const out = mergeStaleChildArray(["a"], ["a", "deleted"], ...STALE, isKnown);
    expect(out).toEqual(["a"]);
  });

  it("a write with NO basis keeps today's behaviour — absence is not evidence", () => {
    // Treating an unprovable write as stale would silently disable every
    // legitimate removal from a path that does not send a timestamp.
    const out = mergeStaleChildArray(["a"], ["a", "b"], NaN, 2000, isKnown);
    expect(out).toEqual(["a"]);
  });

  it("leaves a first-ever write alone (nothing stored yet)", () => {
    expect(mergeStaleChildArray(["a"], [], ...STALE, isKnown)).toEqual(["a"]);
  });
});
