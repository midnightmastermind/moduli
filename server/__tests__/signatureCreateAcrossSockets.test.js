// server/__tests__/signatureCreateAcrossSockets.test.js
//
// Final review I4 (media plan, 2026-11-02). The duplicate-signature refusal is
// check-then-insert, and each socket drains its creates on its OWN queue. Two
// tabs creating the same signed row ~7ms apart both passed the check and both
// persisted (seen on prod: two Watch entries for one viewing). A signed create
// is now serialized with every other signed create for the same user + grid,
// across sockets, so the second one's check sees the first one's write.
import { describe, it, expect, vi, beforeEach } from "vitest";

const delayed = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const db = new Map();

vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOne: vi.fn(({ id }) => ({ lean: () => delayed(1, db.get(id) || null) })),
    find: vi.fn((filter) => {
      const q = { setOptions: () => q, lean: async () => { await delayed(1); return (filter?.id?.$in || []).map((i) => db.get(i)).filter(Boolean); } };
      return q;
    }),
    findOneAndDelete: vi.fn(async ({ id }) => { db.delete(id); return null; }),
    bulkWrite: vi.fn(async (ops) => {
      await delayed(5); // a real round trip: the window the race lived in
      for (const op of ops) {
        const o = op.updateOne || op.replaceOne;
        if (!o) continue;
        if (op.replaceOne) { db.set(o.filter.id, o.replacement); continue; }
        const prev = db.get(o.filter.id);
        if (o.update?.$push) {
          if (!prev) continue;
          const spec = o.update.$push.occurrences; const each = spec?.$each ?? [spec];
          db.set(o.filter.id, { ...prev, occurrences: [...(prev.occurrences || []), ...each] });
        } else db.set(o.filter.id, { ...(prev || { id: o.filter.id }), ...(o.update.$set || o.update) });
      }
      return { ok: 1 };
    }),
    findOneAndUpdate: vi.fn(async () => null),
  },
}));
vi.mock("../models/Grid.js", () => ({ default: { findOne: vi.fn(() => ({ lean: () => delayed(1, null) })), findOneAndUpdate: vi.fn(() => delayed(1, null)) } }));
vi.mock("../models/Module.js", () => ({ default: {} }));
vi.mock("../models/View.js", () => ({ default: {} }));
vi.mock("../models/Folder.js", () => ({ default: {} }));
vi.mock("../models/Manifest.js", () => ({ default: {} }));
vi.mock("../models/Field.js", () => ({ default: {} }));
vi.mock("../models/Operation.js", () => ({ default: {} }));
vi.mock("../services/thumbnailService.js", () => ({ invalidateThumbnail: vi.fn() }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: vi.fn(), flushAction: vi.fn(), flushAll: vi.fn() }));

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");

let uc;
function tab(id) {
  const handlers = new Map();
  const socket = {
    id, userId: "u1", data: { activeGridId: "g1" },
    on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
    emit: vi.fn(), to: () => ({ emit: () => {} }),
  };
  registerCrudHandlers(socket, {
    ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: vi.fn(),
    getAllGridsForUser: vi.fn(async () => []), userRoom: (u) => `user:${u}`, gridRoom: (g) => `grid:${g}`,
    getOccurrencesForGrid: vi.fn(() => []), createOccurrenceData: vi.fn((o) => o),
  });
  return (payload) => Promise.all((handlers.get("create_occurrence") || []).map((fn) => fn(payload)));
}

const watch = (id, sig = "watch:row1@2026-11-02T11:00") => ({
  id, userId: "u1", gridId: "g1", moduleId: "m-watch", parentId: "slot",
  identitySignature: sig, meta: { signatureUnique: true }, fields: {},
});

beforeEach(() => {
  db.clear();
  const slot = { id: "slot", userId: "u1", parentId: null, occurrences: [] };
  db.set("slot", { ...slot });
  uc = { occurrencesById: { slot: { ...slot } }, modulesById: {}, viewsById: {}, foldersById: {},
    manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} };
});

describe("a signed create from two tabs at once", () => {
  it("persists exactly one", async () => {
    const a = tab("sA"), b = tab("sB");
    await Promise.all([a({ occurrence: watch("w-a") }), b({ occurrence: watch("w-b") })]);
    await delayed(60);
    const kept = [...db.values()].filter((o) => o.identitySignature?.startsWith("watch:"));
    expect(kept.map((o) => o.id)).toHaveLength(1);
  });
  it("two DIFFERENT signatures from two tabs both persist — the control", async () => {
    const a = tab("sA"), b = tab("sB");
    await Promise.all([a({ occurrence: watch("w-a", "watch:x@1") }), b({ occurrence: watch("w-b", "watch:y@2") })]);
    await delayed(60);
    expect(db.has("w-a") && db.has("w-b")).toBe(true);
  });
});
