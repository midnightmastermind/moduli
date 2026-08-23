// The dangling-ref guard asked the warm cache, and the cache can be the WRONG
// one: caches are keyed by (userId, gridId), and a write landing while
// `activeGridId` is null is checked against a cache holding another grid's 42
// occurrences. On 2026-08-23 that dropped a live day column off the Schedule
// page and the day's schedule vanished from the screen.
import { describe, it, expect } from "vitest";
import { partitionChildRefs, resolveChildRefs } from "../utils/childRefGuard.js";

const cache = (...ids) => (id) => ids.includes(id);
const db = (...ids) => (id) => ids.includes(id);

describe("partitionChildRefs", () => {
  it("keeps what the cache knows and asks about the rest", () => {
    const { keep, verify } = partitionChildRefs(["a", "b", "c"], "p", cache("a", "c"));
    expect(keep).toEqual(["a", "c"]);
    expect(verify).toEqual(["b"]);
  });

  it("keeps the parent's own id without asking", () => {
    // A create emits its parent link before the child row lands, and the parent
    // may list itself in flight.
    expect(partitionChildRefs(["p"], "p", cache()).verify).toEqual([]);
  });

  it("asks about EVERYTHING when the cache is empty — the wrong-grid case", () => {
    // This is the shape of the bug: a null-grid cache vouches for nothing, so
    // every id must be checked rather than every id being dropped.
    const { keep, verify } = partitionChildRefs(["a", "b"], "p", cache());
    expect(keep).toEqual([]);
    expect(verify).toEqual(["a", "b"]);
  });
});

describe("resolveChildRefs", () => {
  it("KEEPS a child the cache missed but the database has", () => {
    // The exact failure: today's column was alive in Mongo and absent from a
    // cache belonging to another grid.
    expect(resolveChildRefs(["col"], "p", cache(), db("col"))).toEqual(["col"]);
  });

  it("still DROPS a child neither knows — the guard keeps working", () => {
    // Without this the fix would be "never drop anything", which reopens the
    // 42 self-restoring dangling refs of 2026-07-29.
    expect(resolveChildRefs(["ghost"], "p", cache(), db())).toEqual([]);
  });

  it("drops only the ghost when both kinds are present", () => {
    expect(resolveChildRefs(["a", "ghost", "b"], "p", cache("a"), db("b"))).toEqual(["a", "b"]);
  });

  it("PRESERVES the incoming order", () => {
    // On a day column the array IS the running order; rebuilding it from two
    // buckets would leave the schedule rotated (0137 repaired exactly that).
    expect(resolveChildRefs(["c", "a", "b"], "p", cache("a"), db("b", "c"))).toEqual(["c", "a", "b"]);
  });

  it("an empty array stays empty, and the parent id survives", () => {
    expect(resolveChildRefs([], "p", cache(), db())).toEqual([]);
    expect(resolveChildRefs(["p"], "p", cache(), db())).toEqual(["p"]);
  });
});

// Found 2026-08-23 while chasing a different bug: the Day Page column listed
// four of its sections TWICE — the same occurrence id, not a cloned row. A child
// listed twice renders twice and can never be right, so the write path refuses
// it rather than leaving it for an integrity rule to notice later.
describe("resolveChildRefs dedupes", () => {
  it("keeps one entry when a child is listed twice", () => {
    expect(resolveChildRefs(["a", "b", "a"], "p", cache("a", "b"), db())).toEqual(["a", "b"]);
  });

  it("keeps the FIRST position, not the last", () => {
    // The running order was built around where the child first appears; moving
    // it to the end would rotate a day column, which 0137 already repaired once.
    expect(resolveChildRefs(["a", "b", "a", "c"], "p", cache("a", "b", "c"), db()))
      .toEqual(["a", "b", "c"]);
  });

  it("dedupes a child only the DATABASE vouches for", () => {
    expect(resolveChildRefs(["x", "x"], "p", cache(), db("x"))).toEqual(["x"]);
  });

  it("leaves a list with no repeats untouched — the control", () => {
    expect(resolveChildRefs(["a", "b", "c"], "p", cache("a", "b", "c"), db())).toEqual(["a", "b", "c"]);
  });
});
