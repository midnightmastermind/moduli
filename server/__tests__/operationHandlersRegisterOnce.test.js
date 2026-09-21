// __tests__/operationHandlersRegisterOnce.test.js
//
// Creating an operation through the Command Center answered with a red
// `server_error: Failed to create operation` — while the operation appeared
// anyway. Measured on prod 2026-09-21 by hooking `WebSocket.send`: ONE
// `create_operation` frame left the browser, and prod's log still carried
//
//   create_operation error: MongoServerError: E11000 duplicate key error
//     collection: moduli.operations index: id_1 dup key: { id: "1790011090292-…" }
//     at Socket.<anonymous> (crud.js:702)
//
// for that same id. One emit, two writes: `crud.js` registers a bespoke
// `socket.on("create_operation")` AND `setupGenericCRUD("operation", …)`, so
// socket.io invokes both, they race on the unique `id` index, and the loser
// throws. The generic twin swallows E11000; the bespoke one turns it into the
// toast. `create_folder` is doubled the same way.
//
// The existing socket harnesses store handlers in a MAP (`handlers[ev] = fn`),
// so a second registration overwrote the first and no test could see this.
// This harness keeps every listener.
import { describe, it, expect, vi, beforeEach } from "vitest";

const upserts = [];
const mkModel = () => ({
  findOneAndUpdate: vi.fn(async (filter, doc) => { upserts.push({ filter, doc }); return doc; }),
  findOneAndDelete: vi.fn(async () => null),
  findOne: vi.fn(() => ({ lean: async () => null })),
  find: vi.fn(() => ({ lean: async () => [] })),
});
vi.mock("../models/Operation.js", () => ({ default: mkModel() }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: vi.fn() }));

function harness() {
  const listeners = {};
  const toSelf = [];
  const toOthers = [];
  const socket = {
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    emit: (ev, payload) => toSelf.push([ev, payload]),
    to: () => ({ emit: (ev, payload) => toOthers.push([ev, payload]) }),
    join: () => {}, leave: () => {},
    data: { activeGridId: "g1" },
    userId: "u1",
  };
  return { listeners, toSelf, toOthers, socket };
}

const uc = () => ({
  _loaded: true, gridId: "g1",
  modulesById: {}, occurrencesById: {}, fieldsById: {},
  manifestsById: {}, viewsById: {}, foldersById: {}, operationsById: {},
});

async function register(h) {
  const cache = uc();
  const mod = await import("../socketHandlers/crud.js");
  (mod.registerCrudHandlers || mod.default)(h.socket, {
    ensureUserCache: () => cache,
    userCacheReady: () => true,
    loadUserIntoCache: async () => {},
    getAllGridsForUser: async () => [],
    userRoom: () => "user:u1",
    gridRoom: () => "grid:u1",
    getOccurrencesForGrid: () => [],
    createOccurrenceData: (o) => o,
  });
  return cache;
}

beforeEach(() => { upserts.length = 0; vi.clearAllMocks(); });

describe("one authoritative listener per socket event", () => {
  it("registers create_operation exactly once", async () => {
    const h = harness(); await register(h);
    expect(h.listeners["create_operation"]?.length).toBe(1);
  });

  it("registers update_operation exactly once", async () => {
    const h = harness(); await register(h);
    expect(h.listeners["update_operation"]?.length).toBe(1);
  });

  it("registers delete_operation exactly once", async () => {
    const h = harness(); await register(h);
    expect(h.listeners["delete_operation"]?.length).toBe(1);
  });

  it("registers create_folder exactly once", async () => {
    const h = harness(); await register(h);
    expect(h.listeners["create_folder"]?.length).toBe(1);
  });

  // Controls: the generic CRUD still covers the verbs that have no bespoke
  // twin, or "exactly one" is also satisfied by deleting the feature.
  it("still registers the folder verbs that only the generic CRUD provides", async () => {
    const h = harness(); await register(h);
    expect(h.listeners["update_folder"]?.length).toBe(1);
    expect(h.listeners["delete_folder"]?.length).toBe(1);
  });

  it("still registers the view and manifest verbs", async () => {
    const h = harness(); await register(h);
    for (const ev of ["create_view", "update_view", "delete_view",
                      "create_manifest", "update_manifest", "delete_manifest"]) {
      expect(h.listeners[ev]?.length, ev).toBe(1);
    }
  });
});

describe("the surviving create_operation persists the whole operation", () => {
  // The bespoke handler whitelisted the columns it saved, and that list has no
  // pipeline / triggerObjects / triggerTypes / schedule / folderId. Today the
  // generic twin's write is what keeps them; with the duplicate gone, the
  // bespoke write is the ONLY one, so a whitelist would silently strip every
  // new operation's pipeline.
  const fullOp = {
    id: "op-1", gridId: "g1", name: "Water",
    pipeline: { sources: ["s"], steps: [{ id: "st1", type: "action" }] },
    triggerObjects: [{ eventType: "onLoad", subjectType: "grid", targetId: "", priority: 5 }],
    triggerTypes: ["onLoad"], triggerType: "onLoad",
    schedule: { kind: "interval", every: 1, unit: "hour", lastFiredAt: null },
    folderId: "cat-1", enabled: true, sortOrder: 3,
  };

  it("writes pipeline, triggers, schedule and folderId to Mongo", async () => {
    const h = harness(); await register(h);
    await h.listeners["create_operation"][0]({ operation: fullOp });
    expect(upserts.length, "expected exactly one upsert for one create").toBe(1);
    const { doc } = upserts[0];
    expect(doc.pipeline).toEqual(fullOp.pipeline);
    expect(doc.triggerObjects).toEqual(fullOp.triggerObjects);
    expect(doc.triggerTypes).toEqual(fullOp.triggerTypes);
    expect(doc.schedule).toEqual(fullOp.schedule);
    expect(doc.folderId).toBe("cat-1");
    expect(doc.userId).toBe("u1");
  });

  it("keeps it in the warm cache with its pipeline", async () => {
    const h = harness(); const cache = await register(h);
    await h.listeners["create_operation"][0]({ operation: fullOp });
    expect(cache.operationsById["op-1"]?.pipeline).toEqual(fullOp.pipeline);
  });

  it("records the create in the undo trail, as the generic twin did", async () => {
    const h = harness(); await register(h);
    const { recordDoc } = await import("../utils/txRecorder.js");
    await h.listeners["create_operation"][0]({ operation: fullOp });
    const call = recordDoc.mock.calls.find(([a]) => a?.model === "operation" && a?.id === "op-1");
    expect(call, "no transaction recorded for the operation create").toBeTruthy();
    expect(call[0].before).toBe(null);
  });

  it("does not answer a good create with server_error", async () => {
    const h = harness(); await register(h);
    await h.listeners["create_operation"][0]({ operation: fullOp });
    expect(h.toSelf.filter(([ev]) => ev === "server_error")).toEqual([]);
  });
});
