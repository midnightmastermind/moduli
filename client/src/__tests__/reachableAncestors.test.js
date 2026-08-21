// `reachableAncestors` — every occurrence this one can be reached FROM.
//
// `buildParentMap` keys child -> ONE parent, LAST WRITER WINS. Correct for the
// things it was built for (where to drop, which cell to paint) and wrong for
// any question of the form "is this under X?", because this grid multi-parents
// deliberately: one Schedule slot is shared across day columns, and a task
// lives in its Tasks container AND in each day's `Todo`.
//
// Measured on poms grid before this shipped: 9 of the 18 rows on the Tasks page
// were listed by more than one parent and ALL NINE resolved their single chain
// away from the Tasks page.
import { describe, it, expect } from "vitest";
import {
  buildParentMap, buildParentsMap, reachableAncestors,
} from "../helpers/dragHitTesting";

/**
 *            page                schedule
 *             |                     |
 *          bucket                 column
 *             \                   /
 *              \_____ task ______/          <- listed by BOTH
 */
const world = () => ({
  page:     { id: "page",     occurrences: ["bucket"] },
  bucket:   { id: "bucket",   occurrences: ["task"], parentId: "page" },
  schedule: { id: "schedule", occurrences: ["column"] },
  column:   { id: "column",   occurrences: ["task"], parentId: "schedule" },
  task:     { id: "task",     parentId: "bucket" },
});

describe("the single-parent map is the thing being replaced", () => {
  // The control. Without this, "reachableAncestors finds both" proves nothing —
  // it might be that nothing was ever ambiguous.
  it("buildParentMap keeps only ONE parent for a multi-listed child", () => {
    const parents = buildParentMap(world());
    expect(["bucket", "column"]).toContain(parents.task);
    expect(typeof parents.task).toBe("string");   // one, not a list
  });

  it("buildParentsMap keeps every parent that lists it", () => {
    expect(buildParentsMap(world()).task.sort()).toEqual(["bucket", "column"]);
  });
});

describe("reachableAncestors", () => {
  it("reaches BOTH roots from a multi-listed child", () => {
    const anc = reachableAncestors("task", world());
    expect(anc).toContain("page");
    expect(anc).toContain("schedule");
  });

  it("is ordered nearest-first, like the chain it replaces", () => {
    const anc = reachableAncestors("task", world());
    expect(anc.indexOf("bucket")).toBeLessThan(anc.indexOf("page"));
    expect(anc.indexOf("column")).toBeLessThan(anc.indexOf("schedule"));
  });

  it("visits a shared ancestor once, not once per path", () => {
    // A diamond: both buckets hang off the same page.
    const w = world();
    w.page.occurrences = ["bucket", "column"];
    w.column.parentId = "page";
    delete w.schedule;
    const anc = reachableAncestors("task", w);
    expect(anc.filter((x) => x === "page")).toHaveLength(1);
  });

  it("terminates on a cycle instead of hanging", () => {
    const w = { a: { id: "a", occurrences: ["b"] }, b: { id: "b", occurrences: ["a"] } };
    expect(reachableAncestors("a", w).sort()).toEqual(["a", "b"].filter((x) => x !== "a"));
  });

  it("falls back to parentId for a child nobody lists", () => {
    const w = { p: { id: "p", occurrences: [] }, kid: { id: "kid", parentId: "p" } };
    expect(reachableAncestors("kid", w)).toEqual(["p"]);
  });

  it("takes the listing AND the parentId when they disagree", () => {
    // The `0178` shape: parentId names one container, another lists it. Both
    // are real routes to the row, so both are ancestors.
    const w = {
      a: { id: "a", occurrences: [] },
      b: { id: "b", occurrences: ["kid"] },
      kid: { id: "kid", parentId: "a" },
    };
    expect(reachableAncestors("kid", w).sort()).toEqual(["a", "b"]);
  });

  it("does not mutate the parents map it was handed", () => {
    // The walk appends `parentId` to the per-node parent list. Doing that in
    // place would poison the memo for every later caller.
    const w = world();
    const parents = buildParentsMap(w);
    const before = JSON.stringify(parents);
    reachableAncestors("task", w, parents);
    reachableAncestors("task", w, parents);
    expect(JSON.stringify(parents)).toBe(before);
  });

  it("returns nothing for a root", () => {
    expect(reachableAncestors("page", world())).toEqual([]);
  });
});
