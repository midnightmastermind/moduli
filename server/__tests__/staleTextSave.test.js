// __tests__/staleTextSave.test.js — a text save built on text the server no
// longer has is refused, even with one tab open.
//
// 2026-10-01: a migration rewrote "2. Albedo"'s first textblock while the user's
// tab had it open; the restart's full_state refreshed the row's updatedAt in the
// tab, the mounted editor kept its old document, and its next save put the
// pre-migration text back. The timestamp check passed (fresh basis) and is
// skipped anyway for a single socket.
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



const POMS = "g-poms", TG2 = "g-test2";
const cache = () => ({ occurrencesById: {}, modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} });

const { registerOccurrenceHandlers, textSaveIsStale } = await import("../socketHandlers/occurrences.js");
const { textmapDigest } = await import("../utils/textmapDigest.js");
const { decompressTextmap } = await import("../utils/textmapCompression.js");

const doc = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const OLD = doc("heading and four pictures"), MIGRATED = doc("paragraph and table");

describe("a text save built on old text", () => {
  let handlers, uc, socket;
  const fire = (payload) => Promise.all((handlers.get("update_occurrence") || []).map(fn => fn(payload)));
  beforeEach(() => {
    db.occurrences.clear(); handlers = new Map();
    const row = { id: "tb", userId: "u1", gridId: "g", moduleId: "m", fields: {}, occurrences: [], textmap: MIGRATED };
    db.occurrences.set("tb", { ...row });
    uc = { occurrencesById: { tb: { ...row } }, modulesById: {} };
    socket = {
      id: "s-only-tab", userId: "u1", data: { activeGridId: "g" },
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };
    registerOccurrenceHandlers(socket, {
      io: makeIo(), userRoom: (u) => `user:${u}`, loadUserIntoCache: vi.fn(),
      userCacheReady: () => true, ensureUserCache: () => uc,
    });
  });
  const stored = () => decompressTextmap(db.occurrences.get("tb").textmap);

  it("is refused with ONE tab open, and the stored text survives (the 2026-10-01 case)", async () => {
    await fire({ occurrence: { id: "tb", textmap: doc("heading and four pictures!") }, textmapBasis: textmapDigest(OLD) });
    expect(stored()).toEqual(MIGRATED);
    const stale = socket.emit.mock.calls.find(([e]) => e === "occurrence_stale");
    expect(stale?.[1].reason).toBe("textmap");
    expect(stale?.[1].occurrence.textmap).toEqual(MIGRATED);   // the client gets the text to show
  });

  it("a save built on the stored text lands (control)", async () => {
    await fire({ occurrence: { id: "tb", textmap: doc("paragraph and table, edited") }, textmapBasis: textmapDigest(MIGRATED) });
    expect(stored()).toEqual(doc("paragraph and table, edited"));
    expect(socket.emit.mock.calls.some(([e]) => e === "occurrence_stale")).toBe(false);
  });

  it("two quick saves from one editor, the second built on the first, both land", async () => {
    const one = doc("paragraph and table 1"), two = doc("paragraph and table 12");
    await Promise.all([
      fire({ occurrence: { id: "tb", textmap: one }, textmapBasis: textmapDigest(MIGRATED) }),
      fire({ occurrence: { id: "tb", textmap: two }, textmapBasis: textmapDigest(one) }),
    ]);
    expect(socket.emit.mock.calls.some(([e]) => e === "occurrence_stale")).toBe(false);
    expect(stored()).toEqual(two);
  });

  it("a save with no basis keeps the old rules", async () => {
    await fire({ occurrence: { id: "tb", textmap: doc("x") } });
    expect(stored()).toEqual(doc("x"));
  });
});

describe("textmapDigest / textSaveIsStale", () => {
  it("ignores key order, not content", () => {
    expect(textmapDigest({ type: "doc", content: [] })).toBe(textmapDigest({ content: [], type: "doc" }));
    expect(textmapDigest(doc("a"))).not.toBe(textmapDigest(doc("b")));
    expect(textmapDigest(null)).toBe("");
  });
  it("the decision", () => {
    expect(textSaveIsStale({ basis: "", incoming: "i", stored: "s" })).toBe(false);
    expect(textSaveIsStale({ basis: "s", incoming: "i", stored: "s" })).toBe(false);
    expect(textSaveIsStale({ basis: "b", incoming: "s", stored: "s" })).toBe(false);
    expect(textSaveIsStale({ basis: "b", incoming: "i", stored: "s", inFlight: "b" })).toBe(false);
    expect(textSaveIsStale({ basis: "b", incoming: "i", stored: "s" })).toBe(true);
  });
});
