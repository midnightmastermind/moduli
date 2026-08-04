// __tests__/deleteOccurrenceParentRace.test.js
//
// The OTHER half of the recurring `dangling-child-ref` error, and the one that
// actually produced it. Prod logs for the ids that went dangling on 2026-08-04
// show `create_occurrence START` → `DONE`: they persisted. So they were not
// phantoms — they were real rows, deleted afterwards while their parent kept
// listing them.
//
// `delete_occurrence` is NOT queued the way create is, so feedSync sweeping N
// copies runs N handlers concurrently. The parent cleanup used to read each
// parent, filter it, and write the WHOLE document back:
//
//     for (const occ of Object.values(uc.occurrencesById)) {   // snapshot
//       const next = { ...occ, occurrences: occ.occurrences.filter(...) };
//       await Occurrence.findOneAndUpdate({ id: next.id }, next);   // per parent
//     }
//
// The snapshot is taken once, but there is an `await` PER PARENT. A handler
// touching two parents therefore holds a stale reference to the second one
// across the first one's round trip; a concurrent handler writes that parent
// in the gap, and the stale write RESTORES the id it removed — naming an
// occurrence that is already gone.
//
// THAT is why only Schedule Table and Schedule Canvas ever showed it: they are
// the only two feeds swept in the same burst, so they are the only pair that
// can sit in one cleanup loop together. A SINGLE-parent test cannot reproduce
// this at all (the earlier version of this file passed against the bug),
// which is exactly why it needs two.
import { describe, it, expect, vi, beforeEach } from "vitest";

function delayed(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const db = { occurrences: new Map() };

vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOne: vi.fn(({ id }) => ({ lean: () => delayed(2, db.occurrences.get(id) || null) })),
    findOneAndDelete: vi.fn(async ({ id }) => {
      await delayed(8);
      const prev = db.occurrences.get(id) || null;
      db.occurrences.delete(id);
      return prev;
    }),
    // Whole-document write — the shape the buggy code used.
    findOneAndUpdate: vi.fn(async ({ id }, update) => {
      await delayed(8);
      const next = { ...(db.occurrences.get(id) || { id }), ...update };
      db.occurrences.set(id, next);
      return next;
    }),
    // Atomic $pull, applied per document at write time — the fix depends on
    // these semantics, so the mock must honour them faithfully.
    updateMany: vi.fn(async (filter, update) => {
      await delayed(8);
      const pull = update?.$pull?.occurrences?.$in;
      if (!pull) return { modifiedCount: 0 };
      const remove = new Set(pull);
      let modifiedCount = 0;
      for (const [id, doc] of db.occurrences) {
        if (!Array.isArray(doc.occurrences)) continue;
        const kept = doc.occurrences.filter((c) => !remove.has(c));
        if (kept.length !== doc.occurrences.length) {
          db.occurrences.set(id, { ...doc, occurrences: kept });
          modifiedCount++;
        }
      }
      return { modifiedCount };
    }),
  },
}));

vi.mock("../models/Grid.js", () => ({
  default: { findOne: vi.fn(() => ({ lean: () => delayed(2, null) })), findOneAndUpdate: vi.fn(() => delayed(2, null)) },
}));
vi.mock("../models/Module.js", () => ({ default: {} }));
vi.mock("../models/View.js", () => ({ default: {} }));
vi.mock("../models/Folder.js", () => ({ default: {} }));
vi.mock("../models/Manifest.js", () => ({ default: {} }));
vi.mock("../models/Field.js", () => ({ default: {} }));
vi.mock("../models/Operation.js", () => ({ default: {} }));
vi.mock("../services/thumbnailService.js", () => ({ invalidateThumbnail: vi.fn() }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: vi.fn(), flushAction: vi.fn(), flushAll: vi.fn() }));

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");

describe("delete_occurrence — concurrent sweeps must not resurrect each other's child ids", () => {
  let handlers, uc;

  // Two feed pages swept at once — Schedule Table and Schedule Canvas.
  const TABLE = "klpjurMStQG8";
  const CANVAS = "z9lntG03zNIP";

  beforeEach(() => {
    db.occurrences.clear();
    handlers = new Map();

    const seed = {};
    const put = (o) => { db.occurrences.set(o.id, { ...o }); seed[o.id] = { ...o }; };

    const tableKids = ["t1", "t2", "t3", "t4"];
    const canvasKids = ["c1", "c2", "c3", "c4"];
    put({ id: TABLE, userId: "u1", parentId: null, occurrences: [...tableKids] });
    put({ id: CANVAS, userId: "u1", parentId: null, occurrences: [...canvasKids] });
    for (const k of tableKids) put({ id: k, userId: "u1", parentId: TABLE, occurrences: [] });
    for (const k of canvasKids) put({ id: k, userId: "u1", parentId: CANVAS, occurrences: [] });

    uc = {
      occurrencesById: seed,
      modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {},
      fieldsById: {}, operationsById: {}, gridsById: {},
    };

    const socket = {
      id: "socket-1", userId: "u1", data: { activeGridId: null },
      on: (event, fn) => handlers.set(event, fn),
      emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };

    registerCrudHandlers(socket, {
      ensureUserCache: () => uc,
      userCacheReady: () => true,
      loadUserIntoCache: vi.fn(),
      getAllGridsForUser: vi.fn(async () => []),
      userRoom: (u) => `user:${u}`,
      gridRoom: (g) => `grid:${g}`,
      getOccurrencesForGrid: vi.fn(() => []),
      createOccurrenceData: vi.fn((o) => o),
    });
  });

  it("sweeping copies across TWO parents at once leaves no id behind", async () => {
    const del = handlers.get("delete_occurrence");

    // feedSync's sweep loop: `for (const dup of duplicates) sweep(dup)` — fired
    // back-to-back, never awaited between.
    await Promise.all(
      ["t1", "t2", "t3", "t4", "c1", "c2", "c3", "c4"].map((id) => del({ occurrenceId: id }))
    );

    for (const id of ["t1", "t2", "t3", "t4", "c1", "c2", "c3", "c4"]) {
      expect(db.occurrences.has(id)).toBe(false);
    }

    // The discriminating assertion: a stale whole-document write puts one of
    // the already-deleted ids back, and the integrity checker reports it as a
    // dangling child ref.
    expect(db.occurrences.get(TABLE).occurrences).toEqual([]);
    expect(db.occurrences.get(CANVAS).occurrences).toEqual([]);
  });

  it("children the sweep did NOT touch stay listed", async () => {
    db.occurrences.set(TABLE, { ...db.occurrences.get(TABLE), occurrences: ["t1", "keeper", "t2"] });
    uc.occurrencesById[TABLE].occurrences = ["t1", "keeper", "t2"];
    db.occurrences.set("keeper", { id: "keeper", userId: "u1", parentId: TABLE, occurrences: [] });
    uc.occurrencesById["keeper"] = { id: "keeper", userId: "u1", parentId: TABLE, occurrences: [] };

    const del = handlers.get("delete_occurrence");
    await Promise.all([del({ occurrenceId: "t1" }), del({ occurrenceId: "t2" })]);

    expect(db.occurrences.get(TABLE).occurrences).toEqual(["keeper"]);
    expect(db.occurrences.has("keeper")).toBe(true);
  });

  it("the warm cache agrees with the database afterwards", async () => {
    const del = handlers.get("delete_occurrence");
    await Promise.all(["t1", "t2", "c1", "c2"].map((id) => del({ occurrenceId: id })));

    for (const pid of [TABLE, CANVAS]) {
      expect(uc.occurrencesById[pid].occurrences).toEqual(db.occurrences.get(pid).occurrences);
    }
  });
});
