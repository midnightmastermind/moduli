// __tests__/updatePayloadMongoId.test.js — ROOT CAUSE of the prod error
//
//   update_occurrence error: MongoServerError: Plan executor error during
//   findAndModify :: caused by :: Performing an update on the path '_id'
//   would modify the immutable field '_id'
//     at Socket.<anonymous> (server/socketHandlers/occurrences.js:377)
//
// `loadUserIntoCache` stores `{ ...leanDoc, id }` (server.js:344), and a lean
// Mongo document carries `_id`. `update_occurrence` then builds
// `next = { ...prev, ...payload }` from that cache entry and hands `next` to
// `findOneAndUpdate` AS THE UPDATE — so EVERY occurrence write `$set`s `_id`.
//
// That is inert while the cached `_id` matches the live document, and the
// moment they diverge Mongo rejects the whole write with ImmutableField (code
// 66). The user's edit is LOST: the handler throws, so the parent `$push` and
// everything after it never runs.
//
// Reproduced in isolation against a scratch database before this test was
// written — same code and message as prod:
//   dbDoc carries _id   -> ImmutableField (code 66)
//   _id stripped        -> WROTE OK
//
// The codebase already knows this hazard in ONE place: txRecorder.js:80 says
// "`_id`/`__v` stripped: `$set: { _id }` on restore is rejected by Mongo" and
// deletes it. The undo path learned it; the WRITE path never did.
//
// Nothing reads `_id` off a cached entity (grep: 0 sites), and the client
// provably never reads it either (CLAUDE.md 2026-08-24), so stripping it is
// safe at both layers.
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
    findOne: vi.fn(({ id }) => ({ lean: () => delayed(1, db.occurrences.get(id) || null) })),
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

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");
const { registerOccurrenceHandlers } = await import("../socketHandlers/occurrences.js");

describe("a cached document's `_id` must never reach an update payload", () => {
  let handlers, uc, socket;
  const fire = (event) => {
    const fns = handlers.get(event) || [];
    return fns.length ? (...args) => Promise.all(fns.map((fn) => fn(...args))) : undefined;
  };

  beforeEach(() => {
    db.occurrences.clear(); db.modules.clear();
    handlers = new Map();

    // THE DIVERGENCE, which is what makes this fire: the row was re-created
    // under the same app id (a new `_id`) while the warm cache still holds the
    // old one — the cache is loaded once and lives for 12 hours.
    db.occurrences.set("occ-1", { _id: "NEW_OID", id: "occ-1", userId: "u1", label: "live", fields: {}, occurrences: [] });
    db.modules.set("mod-1", { _id: "NEW_OID", id: "mod-1", userId: "u1", label: "live" });

    uc = {
      occurrencesById: { "occ-1": { _id: "OLD_OID", id: "occ-1", userId: "u1", label: "cached", fields: {}, occurrences: [] } },
      modulesById: { "mod-1": { _id: "OLD_OID", id: "mod-1", userId: "u1", label: "cached" } },
      viewsById: {}, foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {},
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
  });

  it("update_occurrence persists the edit instead of being rejected", async () => {
    await fire("update_occurrence")({ occurrence: { id: "occ-1", label: "edited" } });
    expect(db.occurrences.get("occ-1").label).toBe("edited");   // the user's edit landed
    expect(String(db.occurrences.get("occ-1")._id)).toBe("NEW_OID");
  });

  it("update_module persists the edit instead of being rejected", async () => {
    await fire("update_module")({ module: { id: "mod-1", label: "edited" } });
    expect(db.modules.get("mod-1").label).toBe("edited");
  });

  it("THE MOCK REJECTS A CHANGED `_id` — without this the tests pass against the bug", () => {
    expect(() => applyUpdate(db.occurrences, { id: "occ-1" }, { $set: { _id: "OTHER" } }))
      .toThrow(/immutable field '_id'/);
  });

  it("AND ACCEPTS AN UNCHANGED ONE — so the guard is about divergence, not `_id` itself", () => {
    expect(() => applyUpdate(db.occurrences, { id: "occ-1" }, { $set: { _id: "NEW_OID", label: "x" } }))
      .not.toThrow();
  });
});
