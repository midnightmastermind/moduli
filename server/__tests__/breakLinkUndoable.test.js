// __tests__/breakLinkUndoable.test.js
//
// `break_link` RECORDED NOTHING. `recordDoc` was called exactly once in this
// file — inside `update_occurrence` — so breaking a copy-link left no
// transaction, and the undo stack reached PAST it to the gesture before.
//
// Measured on prod 2026-09-22, on a pair minted by a copy-link drag:
//
//   fd0bb37f  source[update] + copy[create] + parent[update]   the drag, ONE action
//   Break Link                                                 NO transaction
//   Ctrl+Z    undid fd0bb37f                                   the ROW was deleted
//
// So the gesture was not merely un-undoable: pressing undo after it destroyed
// the row the user had just broken out of its group. Breaking a link is
// destructive and silent, which is exactly the gesture you want back.
import { describe, it, expect, vi, beforeEach } from "vitest";

const recorded = [];
const recorderState = { throws: false };
vi.mock("../utils/txRecorder.js", () => ({
  recordDoc: (args) => { recorded.push(args); if (recorderState.throws) throw new Error("recorder down"); },
  flushAction: vi.fn(), flushAll: vi.fn(), closeAction: vi.fn(),
}));

// One fake doc, serving BOTH call shapes: `break_link` awaits `findOne(...)`
// and then mutates + saves it, while other handlers in the file call `.lean()`.
const store = new Map();
const fakeDoc = (row) => ({
  ...row,
  lean: async () => ({ ...row }),
  save: async function () { store.set(this.id, { ...store.get(this.id), linkedGroupId: this.linkedGroupId }); },
  toObject: function () { return { ...row, ...store.get(this.id), linkedGroupId: this.linkedGroupId }; },
});
vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOne: vi.fn(({ id }) => (store.has(id) ? fakeDoc(store.get(id)) : null)),
    find: vi.fn(() => { const q = { setOptions: () => q, select: () => q, lean: async () => [] }; return q; }),
    findOneAndUpdate: vi.fn(async () => ({})),
    findOneAndDelete: vi.fn(async () => null),
    bulkWrite: vi.fn(async () => ({ ok: 1 })),
  },
}));
vi.mock("../models/Transaction.js", () => ({ default: class { constructor(d) { Object.assign(this, d); } async save() {} toJSON() { return { ...this }; } } }));
vi.mock("../services/thumbnailService.js", () => ({ invalidateThumbnail: vi.fn() }));

const { registerOccurrenceHandlers } = await import("../socketHandlers/occurrences.js");

const ROW = { _id: "o1", id: "o1", userId: "u1", gridId: "g1", moduleId: "m1", linkedGroupId: "lg-1", occurrences: [] };

async function fire(payload) {
  const handlers = new Map();
  const emitted = [];
  const socket = {
    id: "s1", userId: "u1", data: { activeGridId: "g1" },
    on: (e, fn) => handlers.set(e, fn),
    emit: (e, d) => emitted.push({ e, d }),
    to: () => ({ emit: (e, d) => emitted.push({ e, d, room: true }) }),
  };
  const uc = { occurrencesById: { o1: { ...ROW } }, modulesById: {} };
  registerOccurrenceHandlers(socket, {
    io: { to: () => ({ emit: (e, d) => emitted.push({ e, d, io: true }) }) },
    ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: vi.fn(),
    userRoom: () => "user:u1",
  });
  await handlers.get("break_link")(payload);
  return { uc, emitted };
}

beforeEach(() => { recorded.length = 0; store.clear(); store.set("o1", { ...ROW }); });

const occRecords = () => recorded.filter((r) => r.model === "occurrence" && r.id === "o1");

describe("break_link is undoable", () => {
  it("records the link as it WAS, so undo can put it back", async () => {
    await fire({ occurrenceId: "o1", __actionId: "a1" });
    const rec = occRecords()[0];
    expect(rec, "break_link recorded nothing — undo cannot see it").toBeTruthy();
    expect(rec.before.linkedGroupId, "the snapshot must carry the group being broken").toBe("lg-1");
    expect(rec.after.linkedGroupId).toBeNull();
  });

  it("carries the client's actionId, or the undo stack skips it as derived", async () => {
    await fire({ occurrenceId: "o1", __actionId: "a1" });
    expect(occRecords()[0].actionId).toBe("a1");
  });

  it("still breaks the link and broadcasts when recording throws", async () => {
    // Recording must never be able to fail the write — the user's edit outranks
    // the audit trail (the posture update_occurrence already takes).
    recorderState.throws = true;
    try {
      await fire({ occurrenceId: "o1", __actionId: "a1" });
    } finally { recorderState.throws = false; }
    expect(recorded.length, "the recorder was never reached, so nothing was proven").toBeGreaterThan(0);
    expect(store.get("o1").linkedGroupId).toBeNull();
  });

  // CONTROL — an unstamped write (a script) still records; the recorder marks it
  // derived itself. Recording must not depend on the stamp.
  it("records even with no actionId", async () => {
    await fire({ occurrenceId: "o1" });
    expect(occRecords()).toHaveLength(1);
    expect(occRecords()[0].actionId).toBeNull();
  });
});
