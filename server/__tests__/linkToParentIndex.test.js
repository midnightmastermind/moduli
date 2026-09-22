// link_occurrence_to_parent: `index` inserts at a position, `quiet` skips the
// echo to the calling socket. Both exist for the upload re-link
// (client helpers/artifactUpload.relistUploaded, 2026-09-21): a file dropped
// between two rows is listed BEFORE its row exists, the server drops it as an
// unknown child, and the upload re-links it once the row lands.
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = new Map();
vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOneAndUpdate: vi.fn(async (filter, update) => {
      const prev = db.get(filter.id);
      if (!prev || prev.userId !== filter.userId) return null;
      const child = update.$push.occurrences?.$each?.[0] ?? update.$push.occurrences;
      if (prev.occurrences.includes(child)) return null;
      const next = [...prev.occurrences];
      const pos = update.$push.occurrences?.$position;
      if (Number.isInteger(pos)) next.splice(pos, 0, child); else next.push(child);
      const doc = { ...prev, occurrences: next };
      db.set(filter.id, doc);
      return doc;
    }),
  },
}));
for (const m of ["Grid", "Module", "View", "Folder", "Manifest", "Field", "Operation"]) {
  vi.doMock(`../models/${m}.js`, () => ({ default: {} }));
}
vi.mock("../services/thumbnailService.js", () => ({ invalidateThumbnail: vi.fn() }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: vi.fn(), flushAction: vi.fn(), flushAll: vi.fn() }));

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");

describe("link_occurrence_to_parent", () => {
  let handlers, socket, uc, roomEmit;
  const fire = (ev, payload) => Promise.all((handlers.get(ev) || []).map((fn) => fn(payload)));

  beforeEach(() => {
    db.clear();
    db.set("board", { id: "board", userId: "u1", occurrences: ["a", "b"] });
    handlers = new Map();
    uc = { occurrencesById: {}, modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} };
    roomEmit = vi.fn();
    socket = {
      id: "s1", userId: "u1", data: { activeGridId: null },
      on: (ev, fn) => handlers.set(ev, [...(handlers.get(ev) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: roomEmit }),
    };
    registerCrudHandlers(socket, {
      ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: vi.fn(),
      getAllGridsForUser: vi.fn(async () => []), userRoom: (u) => `user:${u}`, gridRoom: (g) => `grid:${g}`,
      getOccurrencesForGrid: vi.fn(() => []), createOccurrenceData: vi.fn((o) => o),
    });
  });

  it("inserts at the index it was given", async () => {
    await fire("link_occurrence_to_parent", { occurrenceId: "x", parentOccurrenceId: "board", index: 1 });
    expect(db.get("board").occurrences).toEqual(["a", "x", "b"]);
    expect(uc.occurrencesById.board.occurrences).toEqual(["a", "x", "b"]);
  });

  it("appends without an index (the pipeline re-link, unchanged)", async () => {
    await fire("link_occurrence_to_parent", { occurrenceId: "x", parentOccurrenceId: "board" });
    expect(db.get("board").occurrences).toEqual(["a", "b", "x"]);
    expect(socket.emit).toHaveBeenCalledWith("occurrence_updated", expect.anything());
  });

  it("quiet: tells the other tabs, not the caller", async () => {
    await fire("link_occurrence_to_parent", { occurrenceId: "x", parentOccurrenceId: "board", index: 0, quiet: true });
    expect(roomEmit).toHaveBeenCalledWith("occurrence_updated", expect.anything());
    expect(socket.emit).not.toHaveBeenCalledWith("occurrence_updated", expect.anything());
  });

  it("is idempotent", async () => {
    await fire("link_occurrence_to_parent", { occurrenceId: "a", parentOccurrenceId: "board", index: 1 });
    expect(db.get("board").occurrences).toEqual(["a", "b"]);
  });
});
