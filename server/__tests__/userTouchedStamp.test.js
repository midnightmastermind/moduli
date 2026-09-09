// __tests__/userTouchedStamp.test.js — "i just dont want it to delete anything i edit"
//
// The schedule teardown deletes a day column with nothing beneath it. Sparing a
// day the user EDITED needs a fact no field can carry, and that was MEASURED
// rather than assumed — over the live grid's 40 day columns / 526 rows:
//
//   Completed ticked                        4 of 40   <- what you DID, already spared
//   holds prose                             1 of 40
//   holds a field no op writes              2 of 40   <- drops real edits
//   excluding fields ops UPDATE            30 of 40   <- ops PREFILL Meal/Mood/macros,
//                                                        so this loses your own picks
//   excluding the build's own stamps       30 of 40   <- kept by `Daily Question`,
//                                                        which the APP writes
//   holds any value at all                 40 of 40   <- spares everything, useless
//
// Every candidate either dropped edits or spared the app's own writing, because
// the same fields are written by both sides. The WRITE PATH is the one place
// that knows which is which — and it already does: `txRecorder` marks a write
// `derived` on exactly `!actionId`, which is how undo tells a user's step from
// an op's. So the fact is recorded where it is KNOWN.
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { occurrences: new Map() };
const delayed = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

const makeIo = () => ({
  to: () => ({ emit: () => {} }),
  sockets: { adapter: { rooms: new Map([["user:u1", new Set(["s0"])]]) } },
});

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
    findOneAndUpdate: vi.fn(async (filter, update) => { await delayed(1); return applyUpdate(db.occurrences, filter, update); }),
    findOneAndDelete: vi.fn(async ({ id }) => { db.occurrences.delete(id); return null; }),
    bulkWrite: vi.fn(async () => ({ ok: 1 })),
  },
}));
vi.mock("../models/Module.js", () => ({ default: { findOneAndUpdate: vi.fn(async () => null) } }));
vi.mock("../models/Grid.js", () => ({
  default: { findOne: vi.fn(() => ({ lean: () => delayed(1, null) })), findOneAndUpdate: vi.fn(() => delayed(1, null)) },
}));
vi.mock("../models/View.js", () => ({ default: {} }));
vi.mock("../models/Folder.js", () => ({ default: {} }));
vi.mock("../models/Manifest.js", () => ({ default: {} }));
vi.mock("../models/Field.js", () => ({ default: {} }));
vi.mock("../models/Operation.js", () => ({ default: {} }));
vi.mock("../models/Transaction.js", () => ({ default: class { constructor(d) { Object.assign(this, d); } async save() {} toJSON() { return { ...this }; } } }));
vi.mock("../services/thumbnailService.js", () => ({ invalidateThumbnail: vi.fn() }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: vi.fn(), flushAction: vi.fn(), flushAll: vi.fn(), closeAction: vi.fn() }));

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");
const { registerOccurrenceHandlers } = await import("../socketHandlers/occurrences.js");

describe("a row the user touched says so", () => {
  let handlers, uc, socket;
  const fire = (event) => {
    const fns = handlers.get(event) || [];
    return (...args) => Promise.all(fns.map((fn) => fn(...args)));
  };

  const seed = (meta) => {
    db.occurrences.set("occ-1", { id: "occ-1", userId: "u1", fields: {}, occurrences: [], ...(meta ? { meta } : {}) });
    uc.occurrencesById["occ-1"] = { id: "occ-1", userId: "u1", fields: {}, occurrences: [], ...(meta ? { meta } : {}) };
  };

  beforeEach(() => {
    db.occurrences.clear();
    handlers = new Map();
    uc = {
      occurrencesById: {}, modulesById: {}, viewsById: {}, foldersById: {},
      manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {},
    };
    socket = {
      id: "s1", userId: "u1", data: { activeGridId: "g1" },
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };
    const deps = {
      ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: vi.fn(),
      getAllGridsForUser: vi.fn(async () => []), userRoom: (u) => `user:${u}`, gridRoom: (g) => `grid:${g}`,
      getOccurrencesForGrid: vi.fn(() => []), createOccurrenceData: vi.fn((o) => o),
    };
    registerCrudHandlers(socket, deps);
    registerOccurrenceHandlers(socket, { io: makeIo(), ...deps });
    seed(null);
  });

  it("a GESTURE-driven write stamps meta.userTouched", async () => {
    await fire("update_occurrence")({
      occurrence: { id: "occ-1", fields: { f1: { value: 3 } } },
      __actionId: "act-1",
    });
    expect(db.occurrences.get("occ-1").meta?.userTouched).toBe(true);
  });

  // THE CONTROL, and the whole point: the app writes the same fields you do.
  // A tracker recomputing a value must not make the day look edited.
  it("a DERIVED write (no __actionId) does NOT stamp it", async () => {
    await fire("update_occurrence")({
      occurrence: { id: "occ-1", fields: { f1: { value: 3 } } },
    });
    expect(db.occurrences.get("occ-1").meta?.userTouched).toBeUndefined();
  });

  it("it keeps the rest of meta — a row carries more than this flag", async () => {
    seed({ copyLinkSource: "src-9" });
    await fire("update_occurrence")({
      occurrence: { id: "occ-1", label: "edited" },
      __actionId: "act-1",
    });
    const meta = db.occurrences.get("occ-1").meta;
    expect(meta.userTouched).toBe(true);
    expect(meta.copyLinkSource).toBe("src-9");
  });

  it("an already-stamped row is not rewritten by a later derived write", async () => {
    seed({ userTouched: true });
    await fire("update_occurrence")({ occurrence: { id: "occ-1", label: "recomputed" } });
    // The flag SURVIVES: it records that the row was once edited, and an op
    // writing to it afterwards does not un-edit it.
    expect(db.occurrences.get("occ-1").meta.userTouched).toBe(true);
  });

  // THE DROP. Placement is the PARENT's `occurrences[]`, so dragging a task into
  // a day slot arrives here as an ordinary `update_occurrence` on that slot —
  // which is a descendant of the day column. This is the most common way a day
  // gets edited, and it is covered by the same stamp rather than a second rule.
  // (`CommitHelpers.moveOccurrence` emits `move_occurrence`, which has no call
  // sites and no server handler — the live path is `spliceChildIntoParent`.)
  it("a DROP stamps the slot it landed in — placement is a parent-list write", async () => {
    // The dragged row has to EXIST, or `update_occurrence`'s dangling-child-ref
    // guard strips it from the list and the arm measures the guard instead.
    db.occurrences.set("dragged-in", { id: "dragged-in", userId: "u1", fields: {}, occurrences: [] });
    uc.occurrencesById["dragged-in"] = { id: "dragged-in", userId: "u1", fields: {}, occurrences: [] };
    await fire("update_occurrence")({
      occurrence: { id: "occ-1", occurrences: ["dragged-in"] },
      __actionId: "act-drop",
    });
    const row = db.occurrences.get("occ-1");
    expect(row.meta?.userTouched).toBe(true);
    expect(row.occurrences).toEqual(["dragged-in"]);
  });

  it("a payload carrying its own meta still gets stamped", async () => {
    await fire("update_occurrence")({
      occurrence: { id: "occ-1", meta: { x: 1 } },
      __actionId: "act-1",
    });
    const meta = db.occurrences.get("occ-1").meta;
    expect(meta.userTouched).toBe(true);
    expect(meta.x).toBe(1);
  });
});
