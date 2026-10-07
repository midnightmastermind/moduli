// __tests__/updateRebasesOnConcurrentCreate.test.js
//
// 2026-09-24, poms grid: switching a tab to test grid 2 ran that tab's
// load-time date ops over every page it held — including poms pages it had
// received through the user-wide broadcast — and update_occurrence stamped
// test grid 2's id onto poms' Schedule and Trackers pages. They vanished from
// poms grid (the app loads only rows carrying the grid's id).
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { occurrences: new Map(), modules: new Map() };
const hooks = {};
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
    find: vi.fn((filter) => { const q = { setOptions: () => q, select: () => q, lean: async () => { await delayed(1); hooks.duringFind?.(); return (filter?.id?.$in || []).filter((i) => db.occurrences.has(i)).map((i) => ({ id: i })); } }; return q; }),
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



// 2026-10-07, poms rebuild: a fresh load served TODAY'S day column as
// `{ id, occurrences, textmap, updatedAt }` — no moduleId, no date, no
// signature — while Mongo held the whole row. So `Day Page: Build` could not
// FIND today's column on any load, built it again, was refused as a duplicate,
// and its follow-up writes left a module-less shell per load (54 in a morning).
// The race: the build's create_batch and its follow-up update_occurrence (the
// column's children + textmap) overlap. The update finds no row anywhere
// (isInsert, prev = {}), awaits a child-id check, create_batch caches the
// whole row meanwhile — and the update then cached `{...prev, ...payload}`
// over it.
const { registerOccurrenceHandlers } = await import("../socketHandlers/occurrences.js");

const G = "g1";
const cache = () => ({ occurrencesById: {}, modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} });
const FULL = { id: "col", userId: "u1", gridId: G, moduleId: "m-col", parentId: "page", identitySignature: "daypage:col:2026-10-07",
  fields: { fDate: { value: "2026-10-07" } }, meta: { signatureUnique: true }, occurrences: [] };

describe("update_occurrence and a create that lands during its awaits", () => {
  let handlers, uc, socket;
  const fire = (payload) => Promise.all((handlers.get("update_occurrence") || []).map((fn) => fn(payload)));
  beforeEach(() => {
    db.occurrences.clear(); handlers = new Map(); hooks.duringFind = null;
    uc = cache();
    socket = {
      id: "s1", userId: "u1", data: { activeGridId: G },
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };
    registerOccurrenceHandlers(socket, {
      io: makeIo(), userRoom: (u) => `user:${u}`, loadUserIntoCache: vi.fn(),
      userCacheReady: () => true, ensureUserCache: () => uc,
    });
  });

  it("the cached row keeps what the create wrote (the 2026-10-07 case)", async () => {
    // create_batch caches the full row while the update awaits its child check
    // its children are persisted but not yet in the warm cache (their own create is in flight)
    db.occurrences.set("kid1", { id: "kid1", userId: "u1", gridId: G });
    hooks.duringFind = () => { uc.occurrencesById.col = { ...FULL }; db.occurrences.set("col", { ...FULL }); };
    await fire({ occurrence: { id: "col", occurrences: ["kid1"], textmap: { type: "doc", content: [] } } });
    const row = uc.occurrencesById.col;
    expect(row.moduleId).toBe("m-col");
    expect(row.identitySignature).toBe("daypage:col:2026-10-07");
    expect(row.fields).toEqual(FULL.fields);
    expect(row.meta).toEqual(FULL.meta);
    expect(row.occurrences).toEqual(["kid1"]);          // the update's own change still lands
    expect(row.textmap).toEqual({ type: "doc", content: [] });
  });

  it("CONTROL: with no concurrent create, an update of a cached row merges as before", async () => {
    uc.occurrencesById.col = { ...FULL }; db.occurrences.set("col", { ...FULL });
    await fire({ occurrence: { id: "col", label: "x" } });
    expect(uc.occurrencesById.col).toMatchObject({ moduleId: "m-col", label: "x" });
  });

  it("an update that would INSERT an id this socket's create_batch refused writes nothing", async () => {
    socket.data.refusedCreateIds = new Map([["dup", Date.now()]]);
    await fire({ occurrence: { id: "dup", occurrences: ["kid1"], textmap: { type: "doc", content: [] } } });
    expect(db.occurrences.has("dup")).toBe(false);
    expect(uc.occurrencesById.dup).toBeUndefined();
  });

  it("CONTROL: an insert of an id nobody refused still lands", async () => {
    socket.data.refusedCreateIds = new Map([["other", Date.now()]]);
    await fire({ occurrence: { id: "fresh", label: "new" } });
    expect(db.occurrences.get("fresh")).toMatchObject({ label: "new" });
  });
});
