// A child listed by TWO parents keeps the parent named by its own `parentId` (its
// home) in the reverse map, whatever order the occurrences arrive in. Before, the
// LAST lister won: once Day Page: Build listed the Schedule's Todo under a day-page
// column, every row in that Todo lost the Schedule from its `_ancestors`, so every
// "under Schedule" rule (trackers, Tasks Completed, scoped triggers) missed it.
// Found building Day Page: Build Tasks Completed on the rebuild (2026-10-05); on
// poms the same 8 day-page Todos lose it, decided only by storage order.
import { describe, it, expect } from "vitest";
import { buildParentMap } from "../helpers/dragHitTesting";

const world = (order) => {
  const occs = {
    sched: { id: "sched", occurrences: ["schedCol"] },
    schedCol: { id: "schedCol", parentId: "sched", occurrences: ["todo"] },
    dayPage: { id: "dayPage", occurrences: ["dpCol"] },
    dpCol: { id: "dpCol", parentId: "dayPage", occurrences: ["todo"] },
    todo: { id: "todo", parentId: "schedCol", occurrences: ["task"] },
    task: { id: "task", parentId: "todo" },
  };
  return Object.fromEntries(order.map((k) => [k, occs[k]]));
};

describe("buildParentMap prefers a child's own home", () => {
  it("home lister first", () => {
    expect(buildParentMap(world(["sched", "schedCol", "dayPage", "dpCol", "todo", "task"])).todo).toBe("schedCol");
  });
  it("home lister LAST — the order that lost the Schedule", () => {
    expect(buildParentMap(world(["dayPage", "dpCol", "todo", "task", "sched", "schedCol"].reverse())).todo).toBe("schedCol");
    expect(buildParentMap(world(["sched", "schedCol", "todo", "task", "dayPage", "dpCol"])).todo).toBe("schedCol");
  });
  // Control: a parentId naming a parent that does NOT list the child is stale, so
  // the lister still wins (a moved row's old home must not pull it back).
  it("a stale parentId does not override the real lister", () => {
    const occs = world(["sched", "schedCol", "dayPage", "dpCol", "todo", "task"]);
    occs.schedCol = { ...occs.schedCol, occurrences: [] };
    expect(buildParentMap(occs).todo).toBe("dpCol");
  });
  it("a child with one lister is unchanged", () => {
    expect(buildParentMap(world(["sched", "schedCol", "todo", "task"])).task).toBe("todo");
  });
});

import { allAncestorsOf } from "../helpers/dragHitTesting";
describe("allAncestorsOf — under X through ANY parent", () => {
  const occs = {
    sched: { id: "sched", occurrences: ["schedCol"] },
    schedCol: { id: "schedCol", parentId: "sched", occurrences: ["todo", "slot"] },
    dayPage: { id: "dayPage", occurrences: ["dpCol"] },
    dpCol: { id: "dpCol", parentId: "dayPage", occurrences: ["todo"] },
    todo: { id: "todo", parentId: "schedCol", occurrences: ["task"] },
    task: { id: "task", parentId: "todo" },
    tasksPage: { id: "tasksPage", occurrences: ["appts"] },
    appts: { id: "appts", parentId: "tasksPage", occurrences: ["shift"] },
    slot: { id: "slot", parentId: "schedCol", occurrences: ["shift"] },
    shift: { id: "shift", parentId: "appts" },
  };
  const map = buildParentMap(occs);
  it("a Todo row reaches the Schedule AND the day page, home chain first", () => {
    const a = allAncestorsOf("task", occs, map);
    expect(a.slice(0, 3)).toEqual(["todo", "schedCol", "sched"]);
    expect(a).toEqual(expect.arrayContaining(["dpCol", "dayPage"]));
  });
  it("a row homed in Tasks but placed in a Schedule slot is under BOTH", () => {
    const a = allAncestorsOf("shift", occs, map);
    expect(a[0]).toBe("appts");
    expect(a).toEqual(expect.arrayContaining(["tasksPage", "slot", "schedCol", "sched"]));
  });
  it("works through an Object.create layer (the sweep's per-sweep map)", () => {
    expect(allAncestorsOf("task", occs, Object.create(map))).toEqual(expect.arrayContaining(["sched", "dayPage"]));
  });
  it("a single-parent row is exactly its chain", () => {
    expect(allAncestorsOf("todo", { ...occs, dpCol: { ...occs.dpCol, occurrences: [] } }, buildParentMap({ ...occs, dpCol: { ...occs.dpCol, occurrences: [] } }))).toEqual(["schedCol", "sched"]);
  });
});
