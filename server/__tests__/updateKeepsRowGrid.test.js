// __tests__/updateKeepsRowGrid.test.js — a row keeps its own grid.
//
// 2026-09-24, poms grid: switching a tab to test grid 2 ran that tab's
// load-time date ops over every page it held — including poms pages it had
// received through the user-wide broadcast — and update_occurrence stamped
// test grid 2's id onto poms' Schedule and Trackers pages. They vanished from
// poms grid (the app loads only rows carrying the grid's id).
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { occurrences: new Map(), modules: new Map() };
const delayed = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

const makeIo = () => ({
  to: () => ({ emit: () => {} }),
  sockets: { adapter: { rooms: new Map([["user:u1", new Set(["s0"])]]) } },
});

// Mongo REJECTS an update that would change `_id`, and accepts one that leaves
// it alone. Modelling that is the whole point — a mock that silently accepts
// `$set: { _id }` would make these tests pass against the bug.
const applyUpdate = (store, filter, update) => {
  const id = filter.id;
  const prev = store.get(id);
  const patch = update?.$set ?? update;
  if (prev && "_id" in patch && String(patch._id) !== String(prev._id)) {
    const err = new Error("Plan executor error during findAndModify :: caused by :: Performing an update on the path '_id' would modify the immutable field '_id'");
    err.code = 66; err.codeName = "ImmutableField";
    throw err;
  }
  const next = { ...(prev || { id }), ...patch };
  store.set(id, next);
  return next;
};

vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOne: vi.fn(({ id }) => ({ lean: () => ({ catch: () => delayed(1, db.occurrences.get(id) || null), then: (r, j) => delayed(1, db.occurrences.get(id) || null).then(r, j) }) })),
    find: vi.fn(() => { const q = { setOptions: () => q, select: () => q, lean: async () => [] }; return q; }),
    findOneAndUpdate: vi.fn(async (filter, update) => { await delayed(1); return applyUpdate(db.occurrences, filter, update); }),
    findOneAndDelete: vi.fn(async ({ id }) => { db.occurrences.delete(id); return null; }),
    bulkWrite: vi.fn(async () => ({ ok: 1 })),
  },
}));
vi.mock("../models/Module.js", () => ({
  default: { findOneAndUpdate: vi.fn(async (filter, update) => { await delayed(1); return applyUpdate(db.modules, filter, update); }) },
}));
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


const { registerOccurrenceHandlers } = await import("../socketHandlers/occurrences.js");

const POMS = "g-poms", TG2 = "g-test2";
const cache = () => ({ occurrencesById: {}, modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} });

describe("update_occurrence keeps a row on its own grid", () => {
  let handlers, caches, warm;
  const fire = (payload) => Promise.all((handlers.get("update_occurrence") || []).map(fn => fn(payload)));
  beforeEach(() => {
    db.occurrences.clear(); handlers = new Map();
    // poms' Schedule page, as it sits in Mongo and in poms' own warm cache.
    const schedule = { id: "sched", userId: "u1", gridId: POMS, moduleId: "m-sched", label: null, occurrences: ["col1"], fields: {}, filterOverride: { fDate: "2026-09-23" } };
    db.occurrences.set("sched", { ...schedule });
    caches = { [POMS]: cache(), [TG2]: cache() };
    caches[POMS].occurrencesById.sched = { ...schedule };
    caches[POMS].occurrencesById.col1 = { id: "col1", userId: "u1", gridId: POMS };
    caches[TG2].occurrencesById.own = { id: "own", userId: "u1", gridId: TG2, fields: {}, occurrences: [] };
    db.occurrences.set("own", { ...caches[TG2].occurrencesById.own });
    warm = new Set([POMS, TG2]);
    const socket = {
      id: "s-tab-on-test2", userId: "u1", data: { activeGridId: TG2 },   // the tab is on TEST GRID 2
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };
    registerOccurrenceHandlers(socket, {
      io: makeIo(), userRoom: (u) => `user:${u}`, loadUserIntoCache: vi.fn(),
      userCacheReady: (_u, g) => warm.has(g), ensureUserCache: (_u, g) => caches[g],
    });
  });

  it("a test-grid-2 tab writing poms' Schedule page leaves it ON POMS (the 2026-09-24 case)", async () => {
    await fire({ occurrence: { id: "sched", filterOverride: { fDate: "2026-09-24" } } });
    const row = db.occurrences.get("sched");
    expect(row.gridId).toBe(POMS);
    expect(row.filterOverride).toEqual({ fDate: "2026-09-24" });   // the write itself still lands
  });

  it("the write goes to POMS' cache (so its next load is right), never into test grid 2's", async () => {
    await fire({ occurrence: { id: "sched", filterOverride: { fDate: "2026-09-24" } } });
    expect(caches[TG2].occurrencesById.sched).toBeUndefined();
    expect(caches[POMS].occurrencesById.sched.filterOverride).toEqual({ fDate: "2026-09-24" });
    expect(caches[POMS].occurrencesById.sched.occurrences).toEqual(["col1"]);   // merged, not replaced
  });

  it("with poms' cache COLD, Mongo keeps the grid and no cache is touched", async () => {
    warm.delete(POMS);
    await fire({ occurrence: { id: "sched", filterOverride: { fDate: "2026-09-24" } } });
    expect(db.occurrences.get("sched").gridId).toBe(POMS);
    expect(caches[TG2].occurrencesById.sched).toBeUndefined();
  });

  it("a payload naming ANOTHER grid does not move an existing row", async () => {
    await fire({ occurrence: { id: "sched", gridId: TG2, label: "x" } });
    expect(db.occurrences.get("sched").gridId).toBe(POMS);
  });

  it("CONTROL: a row on the tab's own grid is written as before", async () => {
    await fire({ occurrence: { id: "own", label: "edited" } });
    expect(db.occurrences.get("own")).toMatchObject({ gridId: TG2, label: "edited" });
    expect(caches[TG2].occurrencesById.own.label).toBe("edited");
  });

  it("CONTROL: a brand-new row takes the tab's grid", async () => {
    await fire({ occurrence: { id: "fresh", label: "new" } });
    expect(db.occurrences.get("fresh").gridId).toBe(TG2);
  });
});
