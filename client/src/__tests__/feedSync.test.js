// Feed engine tests (2026-07-07): resolveFeedItems (the query) + syncFeed
// (the materializer that replaced Table: Build / Canvas: Build).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveFeedItems } from "../state/selectors";
import { syncFeed } from "../helpers/feedSync";

const F_DONE = "fidDone";
const F_DATE = "fidDate";

function world() {
  const modulesById = {
    mPage: { id: "mPage", role: "page", kind: "board", label: "Schedule" },
    mFeedPage: { id: "mFeedPage", role: "page", kind: "table", label: "Mirror" },
    mSlot: { id: "mSlot", role: "container", kind: "board", label: "6:00am" },
    mTask: { id: "mTask", role: "instance", kind: "board", label: "Run" },
    mNote: { id: "mNote", role: "textblock", kind: "doc", label: "Note" },
  };
  const occurrencesById = {
    sched: { id: "sched", moduleId: "mPage", occurrences: ["slot1"] },
    slot1: { id: "slot1", moduleId: "mSlot", occurrences: ["task1", "task2", "note1"] },
    task1: { id: "task1", moduleId: "mTask", fields: { [F_DONE]: { value: true, flow: "in" } } },
    task2: { id: "task2", moduleId: "mTask", fields: { [F_DONE]: { value: false, flow: "in" } } },
    note1: { id: "note1", moduleId: "mNote", fields: {} },
    feedPage: { id: "feedPage", moduleId: "mFeedPage", occurrences: [], feed: null },
    elsewhere: { id: "elsewhere", moduleId: "mTask", fields: { [F_DONE]: { value: true, flow: "in" } } },
  };
  return { modulesById, occurrencesById };
}

describe("resolveFeedItems", () => {
  it("pulls role-matched occurrences scoped under a page", () => {
    const { modulesById, occurrencesById } = world();
    const feedOcc = { ...occurrencesById.feedPage, feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    const items = resolveFeedItems(feedOcc, { occurrencesById, modulesById });
    expect(items.map(i => i.occurrence.id).sort()).toEqual(["task1", "task2"]);
  });

  it("applies filter-menu-shaped conditions", () => {
    const { modulesById, occurrencesById } = world();
    const feedOcc = { ...occurrencesById.feedPage, feed: {
      enabled: true, roles: ["instance"], scope: "sched",
      conditions: [{ id: "c1", fieldId: F_DONE, comparator: "IS", value: true }],
    } };
    const items = resolveFeedItems(feedOcc, { occurrencesById, modulesById });
    expect(items.map(i => i.occurrence.id)).toEqual(["task1"]);
  });

  it("no scope = whole grid; roles gate what's pullable", () => {
    const { modulesById, occurrencesById } = world();
    const feedOcc = { ...occurrencesById.feedPage, feed: { enabled: true, roles: ["textblock"] } };
    const items = resolveFeedItems(feedOcc, { occurrencesById, modulesById });
    expect(items.map(i => i.occurrence.id)).toEqual(["note1"]);
  });

  it("never pulls feed copies (meta.feedSourceId), the owner, or its own descendants", () => {
    const { modulesById, occurrencesById } = world();
    occurrencesById.copy1 = { id: "copy1", moduleId: "mTask", meta: { feedSourceId: "task1" }, fields: {} };
    occurrencesById.owned = { id: "owned", moduleId: "mTask", fields: {} };
    occurrencesById.feedPage = { ...occurrencesById.feedPage, occurrences: ["owned"] };
    const feedOcc = { ...occurrencesById.feedPage, feed: { enabled: true, roles: ["instance"] } };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id);
    expect(ids).not.toContain("copy1");
    expect(ids).not.toContain("owned");
    expect(ids).not.toContain("feedPage");
  });

  it("sorts by field and respects limit", () => {
    const { modulesById, occurrencesById } = world();
    occurrencesById.task1.fields[F_DATE] = { value: "2026-07-09", flow: "in" };
    occurrencesById.task2.fields[F_DATE] = { value: "2026-07-07", flow: "in" };
    const feedOcc = { ...occurrencesById.feedPage, feed: {
      enabled: true, roles: ["instance"], scope: "sched",
      sort: { fieldId: F_DATE, dir: "asc" }, limit: 1,
    } };
    const items = resolveFeedItems(feedOcc, { occurrencesById, modulesById });
    expect(items.map(i => i.occurrence.id)).toEqual(["task2"]);
  });

  it("disabled or missing feed → empty", () => {
    const { modulesById, occurrencesById } = world();
    expect(resolveFeedItems(occurrencesById.feedPage, { occurrencesById, modulesById })).toEqual([]);
  });
});

describe("syncFeed (materializer)", () => {
  let emitted;
  const socket = { connected: true, emit: (...args) => emitted.push(args), io: { opts: {} } };
  const dispatch = vi.fn();
  beforeEach(() => { emitted = []; dispatch.mockClear(); });

  const state = (occurrencesById) => ({
    userId: "u1", gridId: "g1", grid: { _id: "g1", namedFilters: [], activeFilterId: null },
    occurrences: Object.values(occurrencesById),
  });

  it("mints copy-linked children (meta.feedSourceId, dragMode copy) for matches", () => {
    const { modulesById, occurrencesById } = world();
    const feedOcc = { ...occurrencesById.feedPage, feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    occurrencesById.feedPage = feedOcc;
    const r = syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    expect(r.minted).toBe(2);
    const creates = emitted.filter(([ev]) => ev === "create_occurrence").map(([, p]) => p.occurrence);
    expect(creates).toHaveLength(2);
    for (const c of creates) {
      expect(c.meta.feedSourceId).toBeTruthy();
      expect(c.dragMode).toBe("copy");
      expect(c.linkedGroupId).toBeTruthy();
      expect(c.parentId).toBe("feedPage");
    }
    expect(new Set(creates.map(c => c.meta.feedSourceId))).toEqual(new Set(["task1", "task2"]));
  });

  it("multi-mint accumulates the parent's child list (no clobber)", () => {
    const { modulesById, occurrencesById } = world();
    const feedOcc = { ...occurrencesById.feedPage, feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    occurrencesById.feedPage = feedOcc;
    syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    // The LAST parent occurrences[] write must contain BOTH minted copies —
    // 2026-07-07 regression: per-mint stale parent reads meant only the final
    // copy survived in the child list.
    const parentWrites = emitted
      .filter(([ev, p]) => ev === "update_occurrence" && p.occurrence?.id === "feedPage" && Array.isArray(p.occurrence.occurrences))
      .map(([, p]) => p.occurrence.occurrences);
    const last = parentWrites[parentWrites.length - 1];
    expect(last).toHaveLength(2);
  });

  it("is idempotent: existing copies are not re-minted", () => {
    const { modulesById, occurrencesById } = world();
    occurrencesById.copyA = { id: "copyA", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "task1" }, fields: {} };
    occurrencesById.copyB = { id: "copyB", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "task2" }, fields: {} };
    const feedOcc = { ...occurrencesById.feedPage, occurrences: ["copyA", "copyB"], feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    occurrencesById.feedPage = feedOcc;
    const r = syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    expect(r).toEqual({ minted: 0, swept: 0 });
    expect(emitted.filter(([ev]) => ev === "create_occurrence")).toHaveLength(0);
  });

  it("re-links an existing unreferenced copy instead of minting a duplicate", () => {
    const { modulesById, occurrencesById } = world();
    // copy exists (parentId points at the feed) but the parent list LOST it
    occurrencesById.copyLost = { id: "copyLost", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "task1" }, fields: {} };
    const feedOcc = { ...occurrencesById.feedPage, occurrences: [], feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    occurrencesById.feedPage = feedOcc;
    const r = syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    // task1's copy re-linked (no new mint for it); task2 minted fresh
    expect(r.minted).toBe(1);
    const creates = emitted.filter(([ev]) => ev === "create_occurrence").map(([, p]) => p.occurrence.meta.feedSourceId);
    expect(creates).toEqual(["task2"]);
    const parentWrites = emitted
      .filter(([ev, p]) => ev === "update_occurrence" && p.occurrence?.id === "feedPage" && Array.isArray(p.occurrence.occurrences))
      .map(([, p]) => p.occurrence.occurrences);
    expect(parentWrites[parentWrites.length - 1]).toContain("copyLost");
  });

  it("sweeps duplicate copies of the same source", () => {
    const { modulesById, occurrencesById } = world();
    occurrencesById.copyA = { id: "copyA", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "task1" }, fields: {} };
    occurrencesById.copyA2 = { id: "copyA2", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "task1" }, fields: {} };
    occurrencesById.copyB = { id: "copyB", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "task2" }, fields: {} };
    const feedOcc = { ...occurrencesById.feedPage, occurrences: ["copyA", "copyA2", "copyB"], feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    occurrencesById.feedPage = feedOcc;
    const r = syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    expect(r.minted).toBe(0);
    expect(r.swept).toBe(1);
    const deletes = emitted.filter(([ev]) => ev === "delete_occurrence").map(([, p]) => p.occurrenceId);
    expect(deletes).toHaveLength(1);
    expect(["copyA", "copyA2"]).toContain(deletes[0]);
  });

  it("sweeps copies whose source stopped matching — but never hand-placed children", () => {
    const { modulesById, occurrencesById } = world();
    occurrencesById.copyGone = { id: "copyGone", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "deleted-src" }, fields: {} };
    occurrencesById.handPlaced = { id: "handPlaced", moduleId: "mTask", parentId: "feedPage", fields: {} };
    const feedOcc = {
      ...occurrencesById.feedPage,
      occurrences: ["copyGone", "handPlaced"],
      feed: { enabled: true, roles: ["instance"], scope: "sched", conditions: [{ id: "c", fieldId: F_DONE, comparator: "IS", value: "nothing-matches" }] },
    };
    occurrencesById.feedPage = feedOcc;
    const r = syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    expect(r.swept).toBe(1);
    const deletes = emitted.filter(([ev]) => ev === "delete_occurrence").map(([, p]) => p.occurrenceId);
    expect(deletes).toEqual(["copyGone"]);
  });
});
