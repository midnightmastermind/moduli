// __tests__/updateOperationScheduledEdit.test.js
//
// Filing "Schedule: Mark Passed Slots" into a category through the Command Center sent
// update_operation WITH folderId, and the op stayed uncategorised in the tab and in Mongo.
// The handler's cross-device guard refuses any write whose schedule.lastFiredAt is not newer
// than the stored one, and an EDIT carries the stamp its tab already has — so every edit of a
// scheduled op (name, pipeline, cadence, category) was refused and reverted by the echo.
// The guard now applies only to the scheduler's own stamp (`firedStamp: true`).
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

const T1 = "2026-10-08T20:00:00.000Z", T0 = "2026-10-08T19:55:00.000Z", T2 = "2026-10-08T20:05:00.000Z";
const stored = () => ({ id: "op-s", gridId: "g1", userId: "u1", name: "Mark Passed Slots", folderId: null,
  schedule: { kind: "interval", every: 5, unit: "minute", lastFiredAt: T1 } });

describe("editing a scheduled operation", () => {
  it("an edit carrying the stored lastFiredAt is SAVED (it was refused as a stale fire stamp)", async () => {
    const h = harness(); const cache = await register(h); cache.operationsById["op-s"] = stored();
    await h.listeners["update_operation"][0]({ operation: { ...stored(), folderId: "cat-1" } });
    expect(cache.operationsById["op-s"].folderId).toBe("cat-1");
    expect(upserts.length).toBe(1);
    expect(h.toSelf.find(([ev]) => ev === "operation_updated")).toBeUndefined();
  });

  it("an edit from a tab holding an OLDER stamp is saved and keeps the newer stamp", async () => {
    const h = harness(); const cache = await register(h); cache.operationsById["op-s"] = stored();
    const edit = { ...stored(), name: "Renamed", schedule: { ...stored().schedule, lastFiredAt: T0 } };
    await h.listeners["update_operation"][0]({ operation: edit });
    expect(cache.operationsById["op-s"].name).toBe("Renamed");
    expect(cache.operationsById["op-s"].schedule.lastFiredAt).toBe(T1);
    expect(upserts[0].doc.schedule.lastFiredAt).toBe(T1);
  });
});

describe("the scheduler's fire stamp is still guarded (control)", () => {
  it("a stamp no newer than the stored one is refused and the stored op echoed", async () => {
    const h = harness(); const cache = await register(h); cache.operationsById["op-s"] = stored();
    await h.listeners["update_operation"][0]({ operation: { ...stored(), name: "stale" }, firedStamp: true });
    expect(cache.operationsById["op-s"].name).toBe("Mark Passed Slots");
    expect(upserts.length).toBe(0);
    expect(h.toSelf.find(([ev]) => ev === "operation_updated")).toBeTruthy();
  });

  it("a newer stamp lands", async () => {
    const h = harness(); const cache = await register(h); cache.operationsById["op-s"] = stored();
    await h.listeners["update_operation"][0]({ operation: { ...stored(), schedule: { ...stored().schedule, lastFiredAt: T2 } }, firedStamp: true });
    expect(cache.operationsById["op-s"].schedule.lastFiredAt).toBe(T2);
  });
});
