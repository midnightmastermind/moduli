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

  // Field-check conditions on a tags-style ARRAY field (2026-07-12): a
  // collector page pulls textblocks tagged X via CONTAINS (exact member
  // match on arrays), and IS_NOT_EMPTY doubles as "has this field at all".
  it("CONTAINS on an array field matches exact tag membership", () => {
    const { modulesById, occurrencesById } = world();
    const F_TAGS = "fidTags";
    occurrencesById.note1.fields[F_TAGS] = { value: ["health", "journal"], flow: "in" };
    occurrencesById.note2 = { id: "note2", moduleId: "mNote", fields: { [F_TAGS]: { value: ["work"], flow: "in" } } };
    occurrencesById.note3 = { id: "note3", moduleId: "mNote", fields: {} };
    const feedOcc = { ...occurrencesById.feedPage, feed: {
      enabled: true, roles: ["textblock"],
      conditions: [{ id: "c1", fieldId: F_TAGS, comparator: "CONTAINS", value: "journal" }],
    } };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id);
    expect(ids).toEqual(["note1"]);
  });

  it("CONTAINS on an array does NOT substring-match across members", () => {
    const { modulesById, occurrencesById } = world();
    const F_TAGS = "fidTags";
    occurrencesById.note1.fields[F_TAGS] = { value: ["smart-goals"], flow: "in" };
    const feedOcc = { ...occurrencesById.feedPage, feed: {
      enabled: true, roles: ["textblock"],
      conditions: [{ id: "c1", fieldId: F_TAGS, comparator: "CONTAINS", value: "art" }],
    } };
    expect(resolveFeedItems(feedOcc, { occurrencesById, modulesById })).toEqual([]);
  });

  it("IS_NOT_EMPTY is the has-field check: empty array and missing field both fail", () => {
    const { modulesById, occurrencesById } = world();
    const F_TAGS = "fidTags";
    occurrencesById.note1.fields[F_TAGS] = { value: ["anything"], flow: "in" };
    occurrencesById.note2 = { id: "note2", moduleId: "mNote", fields: { [F_TAGS]: { value: [], flow: "in" } } };
    occurrencesById.note3 = { id: "note3", moduleId: "mNote", fields: {} };
    const feedOcc = { ...occurrencesById.feedPage, feed: {
      enabled: true, roles: ["textblock"],
      conditions: [{ id: "c1", fieldId: F_TAGS, comparator: "IS_NOT_EMPTY" }],
    } };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id);
    expect(ids).toEqual(["note1"]);
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

  it("multi-mint accumulates the parent's child list LOCALLY (no clobber)", () => {
    const { modulesById, occurrencesById } = world();
    const feedOcc = { ...occurrencesById.feedPage, feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    occurrencesById.feedPage = feedOcc;
    syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    // The LAST parent occurrences[] write must contain BOTH minted copies —
    // 2026-07-07 regression: per-mint stale parent reads meant only the final
    // copy survived in the child list. The accumulation invariant is unchanged;
    // what moved (2026-07-29) is WHERE it is observed. The client no longer
    // EMITS the parent-list write — the server's create_occurrence handler
    // $push-es the child atomically, and only once the create persisted — so
    // this asserts on the optimistic DISPATCH instead of the socket.
    // The action shape differs across creators, so pull the occurrence from
    // wherever it sits rather than hard-coding one envelope.
    const occOf = (a) => a?.payload?.occurrence || a?.occurrence || a?.payload || null;
    const parentWrites = dispatch.mock.calls
      .map(([a]) => occOf(a))
      .filter(o => o?.id === "feedPage" && Array.isArray(o.occurrences))
      .map(o => o.occurrences);
    const last = parentWrites[parentWrites.length - 1];
    expect(last).toHaveLength(2);
  });

  it("does NOT emit its own parent-list write — the server owns that push", () => {
    // create_occurrence is QUEUED server-side and bails on disconnect;
    // update_occurrence is neither. A client that went away mid-burst used to
    // leave the parent listing children that were never created (42 such
    // dangling ids in the live grid, 2026-07-29 audit). The create carries
    // parentId, so the server links it atomically or not at all.
    const { modulesById, occurrencesById } = world();
    const feedOcc = { ...occurrencesById.feedPage, feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    occurrencesById.feedPage = feedOcc;
    syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    const parentEmits = emitted.filter(([ev, p]) =>
      ev === "update_occurrence" && p.occurrence?.id === "feedPage");
    expect(parentEmits).toHaveLength(0);
    // …but every create still carries the parent link the server pushes on.
    const creates = emitted.filter(([ev]) => ev === "create_occurrence").map(([, p]) => p.occurrence);
    expect(creates).toHaveLength(2);
    for (const c of creates) expect(c.parentId).toBe("feedPage");
  });

  it("is idempotent: existing copies are not re-minted", () => {
    const { modulesById, occurrencesById } = world();
    occurrencesById.copyA = { id: "copyA", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "task1" }, fields: {} };
    occurrencesById.copyB = { id: "copyB", moduleId: "mTask", parentId: "feedPage", meta: { feedSourceId: "task2" }, fields: {} };
    const feedOcc = { ...occurrencesById.feedPage, occurrences: ["copyA", "copyB"], feed: { enabled: true, roles: ["instance"], scope: "sched" } };
    occurrencesById.feedPage = feedOcc;
    const r = syncFeed(feedOcc, { state: state(occurrencesById), occurrencesById, modulesById, dispatch, socket });
    // toMatchObject, not toEqual: syncFeed also returns diagnostic counts
    // (matches/visible/existing) that this assertion is not about.
    expect(r).toMatchObject({ minted: 0, swept: 0 });
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

// ── $today in a feed condition (2026-08-08) ────────────────────────────────
//
// User, 2026-08-07: "include appointments there too after the date passes for
// it." An appointment stops being upcoming when its DATE HAS PASSED, not when
// it is completed — one you attended and one you missed both stop being
// upcoming. That needs `Date DATE_BEFORE <today>` on a feed, and until now the
// right-hand side had no way to say "today": conditions are evaluated with an
// EMPTY $vars, and a literal date is correct for exactly one day.
//
// The token is resolved ONCE PER SYNC, not per occurrence, so a pass that
// straddles midnight cannot classify two rows against two different "todays".
describe("resolveFeedItems — $today in a condition value", () => {
  const D = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    // LOCAL parts — the same rule the resolver follows.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  function datedWorld() {
    const modulesById = {
      mPage: { id: "mPage", role: "page", kind: "board", label: "Tasks" },
      mMirror: { id: "mMirror", role: "page", kind: "board", label: "Completed" },
      mAppt: { id: "mAppt", role: "instance", kind: "board", label: "Appointment" },
    };
    const occurrencesById = {
      tasks: { id: "tasks", moduleId: "mPage", occurrences: ["past", "today", "future", "undated"] },
      past: { id: "past", moduleId: "mAppt", fields: { [F_DATE]: { value: D(-1) } } },
      today: { id: "today", moduleId: "mAppt", fields: { [F_DATE]: { value: D(0) } } },
      future: { id: "future", moduleId: "mAppt", fields: { [F_DATE]: { value: D(1) } } },
      undated: { id: "undated", moduleId: "mAppt", fields: {} },
      mirror: { id: "mirror", moduleId: "mMirror", occurrences: [], feed: null },
    };
    return { modulesById, occurrencesById };
  }

  it("pulls only occurrences whose date has PASSED", () => {
    const { modulesById, occurrencesById } = datedWorld();
    const feedOcc = { ...occurrencesById.mirror, feed: {
      enabled: true, roles: ["instance"], scope: "tasks",
      conditions: [{ id: "c1", fieldId: F_DATE, comparator: "DATE_BEFORE", value: "$today" }],
    } };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id);
    expect(ids).toEqual(["past"]);
  });

  it("does NOT match today itself — an appointment today is still upcoming", () => {
    const { modulesById, occurrencesById } = datedWorld();
    const feedOcc = { ...occurrencesById.mirror, feed: {
      enabled: true, roles: ["instance"], scope: "tasks",
      conditions: [{ id: "c1", fieldId: F_DATE, comparator: "DATE_BEFORE", value: "$today" }],
    } };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id);
    expect(ids).not.toContain("today");
    expect(ids).not.toContain("future");
  });

  // The failure mode this replaces: an unresolved right-hand side made the
  // condition match EVERYTHING. Proving the undated row is excluded proves the
  // condition is genuinely being evaluated rather than skipped.
  it("excludes an occurrence with no date rather than matching everything", () => {
    const { modulesById, occurrencesById } = datedWorld();
    const feedOcc = { ...occurrencesById.mirror, feed: {
      enabled: true, roles: ["instance"], scope: "tasks",
      conditions: [{ id: "c1", fieldId: F_DATE, comparator: "DATE_BEFORE", value: "$today" }],
    } };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id);
    expect(ids).not.toContain("undated");
  });

  // The safety property, asserted rather than assumed: 71 live feed conditions
  // carry plain strings and one boolean, and none may change meaning.
  it("leaves a plain-string condition untouched", () => {
    const { modulesById, occurrencesById } = datedWorld();
    occurrencesById.past.fields.tag = { value: ["grocery"] };
    const feedOcc = { ...occurrencesById.mirror, feed: {
      enabled: true, roles: ["instance"], scope: "tasks",
      conditions: [{ id: "c1", fieldId: "tag", comparator: "CONTAINS", value: "grocery" }],
    } };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id);
    expect(ids).toEqual(["past"]);
  });
});

// ── OR / nested groups in a feed (2026-08-08) ─────────────────────────────
//
// The Completed container has to hold two unrelated things: todos you ticked,
// and appointments whose date has passed. That is an OR, and the second arm is
// itself an AND (a date rule alone would sweep every past-dated row).
describe("resolveFeedItems — conditionOperator and nested groups", () => {
  const F_SLOT = "fidSlot";
  const D = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  function world2() {
    const modulesById = {
      mPage: { id: "mPage", role: "page", kind: "board", label: "Tasks" },
      mMirror: { id: "mMirror", role: "page", kind: "board", label: "Completed" },
      mRow: { id: "mRow", role: "instance", kind: "board", label: "Row" },
    };
    const F = (fields) => ({ moduleId: "mRow", fields });
    const occurrencesById = {
      tasks: { id: "tasks", moduleId: "mPage", occurrences: ["done", "pastAppt", "futureAppt", "plainPast", "idle"] },
      done: { id: "done", ...F({ [F_DONE]: { value: true } }) },
      pastAppt: { id: "pastAppt", ...F({ [F_DONE]: { value: false }, [F_DATE]: { value: D(-1) }, [F_SLOT]: { value: "9:00am" } }) },
      futureAppt: { id: "futureAppt", ...F({ [F_DONE]: { value: false }, [F_DATE]: { value: D(1) }, [F_SLOT]: { value: "9:00am" } }) },
      // Past-dated but NOT a scheduled event. Only the nested AND excludes it —
      // a flat "date before today" rule would sweep it in.
      plainPast: { id: "plainPast", ...F({ [F_DONE]: { value: false }, [F_DATE]: { value: D(-1) } }) },
      idle: { id: "idle", ...F({ [F_DONE]: { value: false } }) },
      mirror: { id: "mirror", moduleId: "mMirror", occurrences: [], feed: null },
    };
    return { modulesById, occurrencesById };
  }

  const COMPLETED_FEED = {
    enabled: true, roles: ["instance"], scope: "tasks", limit: 300,
    conditionOperator: "OR",
    conditions: [
      { id: "c1", fieldId: F_DONE, comparator: "IS", value: true },
      { id: "g1", operator: "AND", conditions: [
        { id: "c2", fieldId: F_DATE, comparator: "DATE_BEFORE", value: "$today" },
        { id: "c3", fieldId: F_SLOT, comparator: "IS_NOT_EMPTY", value: "" },
      ] },
    ],
  };

  it("pulls the union of a ticked todo and a past scheduled event", () => {
    const { modulesById, occurrencesById } = world2();
    const feedOcc = { ...occurrencesById.mirror, feed: COMPLETED_FEED };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id).sort();
    expect(ids).toEqual(["done", "pastAppt"]);
  });

  it("the nested AND is what excludes a past row that was never scheduled", () => {
    const { modulesById, occurrencesById } = world2();
    const feedOcc = { ...occurrencesById.mirror, feed: COMPLETED_FEED };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id);
    expect(ids).not.toContain("plainPast");
    expect(ids).not.toContain("futureAppt");
    expect(ids).not.toContain("idle");
  });

  // The back-compat guarantee, stated as a test: every live feed omits
  // conditionOperator and must keep ANDing.
  it("a flat list with no operator still ANDs", () => {
    const { modulesById, occurrencesById } = world2();
    const feedOcc = { ...occurrencesById.mirror, feed: {
      enabled: true, roles: ["instance"], scope: "tasks",
      conditions: [
        { id: "c1", fieldId: F_DONE, comparator: "IS", value: false },
        { id: "c2", fieldId: F_SLOT, comparator: "IS_NOT_EMPTY", value: "" },
      ],
    } };
    const ids = resolveFeedItems(feedOcc, { occurrencesById, modulesById }).map(i => i.occurrence.id).sort();
    expect(ids).toEqual(["futureAppt", "pastAppt"]);
  });
});
