// __tests__/occWritesSerialPerRow.test.js — two writes to one row cannot erase each other.
// (Harness copied from updateKeepsRowGrid.test.js.)
//
// 2026-09-24, poms grid: switching a tab to test grid 2 ran that tab's
// load-time date ops over every page it held — including poms pages it had
// received through the user-wide broadcast — and update_occurrence stamped
// test grid 2's id onto poms' Schedule and Trackers pages. They vanished from
// poms grid (the app loads only rows carrying the grid's id).
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { occurrences: new Map(), modules: new Map() };
const delayed = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
// The save that carries the field write AND the old visibility (the first write's whole row) is slow — the realistic shape: a whole-row
// save that started first and finishes last. (Keyed by content, not call order: a
// fields write awaits its MeasureOp save first, so call order is not arrival order.)
const slowFirstFieldsWrite = { armed: false };

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
    findOneAndUpdate: vi.fn(async (filter, update) => { const u = update?.$set ?? update; const ms = slowFirstFieldsWrite.armed && u?.fields?.lr && u?.fieldVisibility?.fieldIds?.length === 1 ? (slowFirstFieldsWrite.armed = false, 30) : 1; await delayed(ms); return applyUpdate(db.occurrences, filter, update); }),
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
const G = "g1";
const cache = () => ({ occurrencesById: {}, modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} });

// 2026-10-06, the rebuild's Today's Session tile: one op sweep wrote a field value
// and then the tile's fieldVisibility; a Mongo change stream showed the new
// visibility land and a write 25ms later put the OLD one back. Every write saves
// the WHOLE merged row, so an older write finishing last erases the newer change.
describe("update_occurrence: writes to one row land in arrival order", () => {
  let fire, uc;
  beforeEach(() => {
    db.occurrences.clear(); slowFirstFieldsWrite.armed = false;
    const tile = { id: "tile", userId: "u1", gridId: G, fields: {}, fieldVisibility: { mode: "show", fieldIds: ["date"] } };
    db.occurrences.set("tile", { ...tile });
    uc = cache(); uc.occurrencesById.tile = { ...tile };
    const handlers = new Map();
    const socket = { id: "s1", userId: "u1", data: { activeGridId: G }, on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]), emit: vi.fn(), to: () => ({ emit: vi.fn() }) };
    registerOccurrenceHandlers(socket, { io: makeIo(), userRoom: (u) => `user:${u}`, loadUserIntoCache: vi.fn(), userCacheReady: () => true, ensureUserCache: () => uc });
    fire = (payload) => (handlers.get("update_occurrence") || []).map((fn) => fn(payload));
  });

  const burst = async () => {
    slowFirstFieldsWrite.armed = true;
    await Promise.all([
      ...fire({ occurrence: { id: "tile", fields: { lr: { value: "1" } } } }),
      ...fire({ occurrence: { id: "tile", fieldVisibility: { mode: "show", fieldIds: ["lr", "date"] } } }),
      ...fire({ occurrence: { id: "tile", fields: { lr: { value: "1" } } } }),
    ]);
  };

  it("Mongo keeps the newer fieldVisibility when an older whole-row save is slow", async () => {
    await burst();
    expect(db.occurrences.get("tile").fieldVisibility.fieldIds).toEqual(["lr", "date"]);
    expect(db.occurrences.get("tile").fields.lr.value).toBe("1");
  });

  it("the warm cache keeps it too (no post-save restamp of an older row)", async () => {
    await burst();
    expect(uc.occurrencesById.tile.fieldVisibility.fieldIds).toEqual(["lr", "date"]);
  });

  it("CONTROL: different rows are not held behind each other", async () => {
    db.occurrences.set("other", { id: "other", userId: "u1", gridId: G, fields: {} });
    uc.occurrencesById.other = { id: "other", userId: "u1", gridId: G, fields: {} };
    slowFirstFieldsWrite.armed = false;
    const t0 = Date.now(); let otherDone = 0;
    slowFirstFieldsWrite.armed = true;
    const a = Promise.all(fire({ occurrence: { id: "tile", fields: { lr: { value: 1 } } } }));
    const b = Promise.all(fire({ occurrence: { id: "other", fields: { x: { value: 2 } } } })).then(() => { otherDone = Date.now() - t0; });
    await Promise.all([a, b]);
    expect(otherDone).toBeLessThan(35);
  });
});
