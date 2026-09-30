// __tests__/updateInsertDuplicate.test.js — an upsert that CREATES is a create.
//
// 2026-09-30, poms grid: today's day page got a SECOND column. create_batch
// refused it as a duplicate signature — but the build's follow-up writes to
// that column reached update_occurrence FIRST, and its upsert wrote the row
// through the one door with no duplicate check.
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
  default: {
    findOneAndUpdate: vi.fn(async (filter, update) => { await delayed(1); return applyUpdate(db.modules, filter, update); }),
    find: vi.fn(() => ({ lean: async () => [...db.modules.values()] })),
  },
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


const G = "g-poms";
const cache = () => ({ occurrencesById: {}, modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} });
const OLD = Date.now() - 60 * 60 * 1000;
const column = (id, extra = {}) => ({
  id, userId: "u1", gridId: G, moduleId: `m-${id}`, parentId: "daypage",
  identitySignature: "daypage:col:2026-09-30", meta: { signatureUnique: true }, createdAt: new Date(OLD).toISOString(), ...extra,
});

describe("update_occurrence that would insert a duplicate-signed row", () => {
  let handlers, uc, socket;
  const fire = (payload) => Promise.all((handlers.get("update_occurrence") || []).map(fn => fn(payload)));
  beforeEach(() => {
    db.occurrences.clear(); db.modules.clear(); handlers = new Map();
    uc = cache();
    uc.occurrencesById.daypage = { id: "daypage", userId: "u1", gridId: G, occurrences: ["colA"] };
    uc.occurrencesById.colA = column("colA");
    uc.modulesById["m-colA"] = { id: "m-colA" };
    db.occurrences.set("colA", { ...uc.occurrencesById.colA });
    db.modules.set("m-colA", { id: "m-colA" });
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

  it("is refused: nothing written, and the originator is told to drop it (the 2026-09-30 case)", async () => {
    await fire({ occurrence: column("colB", { textmap: { type: "doc", content: [] } }) });
    expect(db.occurrences.has("colB")).toBe(false);
    expect(uc.occurrencesById.colB).toBeUndefined();
    expect(socket.emit).toHaveBeenCalledWith("occurrence_deleted", { occurrenceId: "colB" });
  });

  // The controls: the guard is about INSERTING A DUPLICATE, nothing wider.
  it("an insert with no existing holder is written as before", async () => {
    delete uc.occurrencesById.colA; db.occurrences.delete("colA");
    await fire({ occurrence: column("colB") });
    expect(db.occurrences.has("colB")).toBe(true);
  });

  it("an update to the EXISTING holder is written as before", async () => {
    await fire({ occurrence: { id: "colA", label: "edited" } });
    expect(db.occurrences.get("colA").label).toBe("edited");
  });

  it("an insert of a row with no unique signature is written as before", async () => {
    await fire({ occurrence: { id: "plain", userId: "u1", gridId: G, parentId: "daypage", label: "x" } });
    expect(db.occurrences.has("plain")).toBe(true);
  });
});
