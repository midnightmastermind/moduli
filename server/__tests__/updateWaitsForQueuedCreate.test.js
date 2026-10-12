// __tests__/updateWaitsForQueuedCreate.test.js
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


// 2026-10-12, the rebuild grid: update_occurrence is not queued and create_batch is, so a column's follow-up
// write (children + textmap) arrived BEFORE its own create ran, found the row nowhere and upserted a partial,
// module-less row. A refused duplicate's write left that as a SHELL (11 in one morning); today's REAL column
// got its partial save re-stamped into the warm cache — full in Mongo, invisible on screen.
const G = "g-reb";
const cache = () => ({ occurrencesById: {}, modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} });

describe("update_occurrence waits for this socket's queued create of the same row", () => {
  let handlers, c, socket, release;
  const fire = (payload) => Promise.all((handlers.get("update_occurrence") || []).map(fn => fn(payload)));
  beforeEach(() => {
    db.occurrences.clear(); handlers = new Map(); c = cache();
    for (const k of ["a", "b"]) { c.occurrencesById[k] = { id: k, userId: "u1", gridId: G, moduleId: "m-" + k }; db.occurrences.set(k, { ...c.occurrencesById[k] }); }
    let done; const queue = new Promise((r) => { done = r; });
    release = (fn) => { fn(); done(); };
    socket = {
      id: "s1", userId: "u1", data: { activeGridId: G, pendingCreateIds: new Set(["col"]), createQueue: queue, refusedCreateIds: new Set() },
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]), emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };
    registerOccurrenceHandlers(socket, { io: makeIo(), userRoom: (u) => `user:${u}`, loadUserIntoCache: vi.fn(), userCacheReady: () => true, ensureUserCache: () => c });
  });

  it("merges onto the full row its create lands, instead of inserting a partial one", async () => {
    const p = fire({ occurrence: { id: "col", occurrences: ["a", "b"], textmap: { type: "doc" } } });
    await delayed(20);
    release(() => { const full = { id: "col", userId: "u1", gridId: G, moduleId: "m-col", identitySignature: "daypage:col:2026-10-12", occurrences: [] }; c.occurrencesById.col = full; db.occurrences.set("col", { ...full }); socket.data.pendingCreateIds.delete("col"); });
    await p;
    expect(c.occurrencesById.col.moduleId, "the cache holds a row with no module").toBe("m-col");
    expect(c.occurrencesById.col.occurrences).toEqual(["a", "b"]);
    expect(db.occurrences.get("col").moduleId).toBe("m-col");
  });

  it("drops the write when its create was refused, leaving no shell", async () => {
    const p = fire({ occurrence: { id: "col", occurrences: ["a"], textmap: { type: "doc" } } });
    await delayed(20);
    release(() => { socket.data.refusedCreateIds.add("col"); socket.data.pendingCreateIds.delete("col"); });
    await p;
    expect(db.occurrences.has("col"), "a refused create's follow-up write minted a shell").toBe(false);
    expect(c.occurrencesById.col).toBeUndefined();
  });

  it("CONTROL: an insert of an id with NO queued create is not delayed", async () => {
    socket.data.pendingCreateIds = new Set();
    await fire({ occurrence: { id: "fresh", label: "new" } });
    expect(db.occurrences.get("fresh")).toMatchObject({ label: "new", gridId: G });
  });
});
