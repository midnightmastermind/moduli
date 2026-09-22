// UNDOING A CHANGE TO A COPY-LINKED ROW REVERTS THE WHOLE GROUP.
//
// `update_occurrence` propagates a field write to every member of the linked
// group, and recorded ONE doc — the row you edited. So undo put the source back
// and left every copy carrying the new value (measured 2026-09-22 on a 3-member
// group: `src true -> false`, the 7:00am copy stayed `true`). A half-reverted
// group is worse than no undo: the members disagree, and the next edit fans one
// of them back over the other.
//
// The fan-out is recorded under the SAME `__actionId` as the source write, so
// the whole group lands in ONE transaction and one press reverts it together.
//
// Blast radius measured before writing it, across every grid: 671 linked groups
// / 1548 members, largest group 16, and ZERO members carry a textmap — so this
// adds field-only snapshots, never a gzip per member.
import { describe, it, expect, vi, beforeEach } from "vitest";

const recorded = [];
vi.mock("../utils/txRecorder.js", () => ({
  recordDoc: (args) => { recorded.push(args); },
  flushAction: vi.fn(), flushAll: vi.fn(), closeAction: vi.fn(),
}));

const db = { occurrences: new Map() };
const delayed = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const applyUpdate = (store, filter, update) => {
  const patch = update?.$set ?? update;
  const next = { ...(store.get(filter.id) || { id: filter.id }), ...patch };
  store.set(filter.id, next);
  return next;
};
vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOne: vi.fn(({ id }) => ({ lean: () => delayed(1, db.occurrences.get(id) || null) })),
    find: vi.fn(() => { const q = { setOptions: () => q, select: () => q, lean: async () => [] }; return q; }),
    findOneAndUpdate: vi.fn(async (f, u) => { await delayed(1); return applyUpdate(db.occurrences, f, u); }),
    findOneAndDelete: vi.fn(async ({ id }) => { db.occurrences.delete(id); return null; }),
    bulkWrite: vi.fn(async () => ({ ok: 1 })),
  },
}));
vi.mock("../models/Transaction.js", () => ({ default: class { constructor(d) { Object.assign(this, d); } async save() {} toJSON() { return { ...this }; } } }));
vi.mock("../services/thumbnailService.js", () => ({ invalidateThumbnail: vi.fn() }));

const { registerOccurrenceHandlers } = await import("../socketHandlers/occurrences.js");

const DONE = "field-completed";   // shared state — SHOULD fan out

describe("a fan-out is one undo step", () => {
  let handlers, uc, socket;
  const fire = (e) => (...a) => Promise.all((handlers.get(e) || []).map(fn => fn(...a)));

  beforeEach(() => {
    recorded.length = 0;
    db.occurrences.clear();
    handlers = new Map();
    const mk = (id, lg) => ({
      _id: id, id, userId: "u1", gridId: "g1", moduleId: "m1", linkedGroupId: lg,
      occurrences: [], fields: { [DONE]: { value: false, flow: "replace" } },
    });
    for (const id of ["src", "copy-a", "copy-b"]) db.occurrences.set(id, mk(id, "lg-1"));
    db.occurrences.set("loner", mk("loner", null));

    uc = {
      occurrencesById: Object.fromEntries([...db.occurrences].map(([k, v]) => [k, { ...v }])),
      modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {},
      fieldsById: {}, operationsById: {}, gridsById: {},
      filterFieldIds: new Set(), placementFieldIds: new Set(),
    };
    socket = {
      id: "s1", userId: "u1", data: { activeGridId: "g1" },
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };
    registerOccurrenceHandlers(socket, {
      io: { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: new Map() } } },
      ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: vi.fn(),
      userRoom: (u) => `user:${u}`, gridRoom: (g) => `grid:${g}`,
    });
  });

  const tick = async (id, actionId = "a1") => {
    await fire("update_occurrence")({
      occurrence: { id, fields: { [DONE]: { value: true, flow: "replace" } } },
      ...(actionId ? { __actionId: actionId } : {}),
    });
  };
  const forId = (id) => recorded.filter((r) => r.model === "occurrence" && r.id === id);

  it("records every member the write fanned out to, not just the row edited", async () => {
    await tick("src");
    // CONTROL — the fan-out actually happened, or "recorded 3" would be
    // measuring a group that never propagated.
    expect(db.occurrences.get("copy-a").fields[DONE].value, "the fan-out did not run").toBe(true);
    expect(forId("src"), "the edited row was not recorded").toHaveLength(1);
    expect(forId("copy-a"), "a copy the write changed was never recorded — undo cannot revert it").toHaveLength(1);
    expect(forId("copy-b")).toHaveLength(1);
  });

  it("the copies go in under the SAME action id — one press, whole group", async () => {
    await tick("src");
    const ids = [...new Set(recorded.map((r) => r.actionId))];
    expect(ids).toEqual(["a1"]);
  });

  it("a copy's snapshot carries the value it HAD, so undo can restore it", async () => {
    await tick("src");
    const rec = forId("copy-a")[0];
    expect(rec.before.fields[DONE].value, "before must be the pre-fan-out value").toBe(false);
    expect(rec.after.fields[DONE].value).toBe(true);
  });

  // CONTROL — a row in no group still records exactly one doc. Without this,
  // "records the members" is also satisfied by a handler that records
  // everything on the grid.
  it("a row with no linked group records only itself", async () => {
    await tick("loner");
    expect(recorded.filter((r) => r.model === "occurrence")).toHaveLength(1);
    expect(forId("loner")).toHaveLength(1);
  });
});
