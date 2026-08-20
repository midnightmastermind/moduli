// __tests__/createBatching.test.js
//
// THE COST, measured rather than asserted: `handleCreateOccurrence` runs TWO
// serialized Atlas round trips per create — the occurrence upsert and a parent
// `$push` of ONE child — and the whole burst is serialized through a per-socket
// Promise chain. A 49-slot schedule build is therefore ~98 round trips end to
// end, ~65ms each warm, and it drains for SECONDS. That window is what a pm2
// restart truncates (2026-08-20), and it is the reason a deploy landing on the
// user's morning load leaves a half-built schedule.
//
// These tests drive the REAL handler with Mongo mocked, count the round trips,
// and pin the behaviour that the serialization was protecting: emit ORDER in
// the parent's occurrences[], idempotency, and the disconnect/cache contract.
import { describe, it, expect, vi, beforeEach } from "vitest";

const delayed = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));
const db = { occurrences: new Map() };
const trips = { upsert: 0, push: 0, read: 0, bulk: 0, total: 0 };

class AbortError extends Error {
  constructor() { super("The operation was aborted"); this.name = "AbortError"; }
}

const applyUpdate = (id, update) => {
  const prev = db.occurrences.get(id);
  if (update?.$push) {
    if (!prev) return null;
    const spec = update.$push.occurrences;
    const each = spec?.$each ?? [spec];
    const pos = spec?.$position;
    const cur = [...(prev.occurrences || [])];
    const add = each.filter((c) => !cur.includes(c));
    if (!add.length) return null;
    const next = { ...prev, occurrences: typeof pos === "number"
      ? [...cur.slice(0, pos), ...add, ...cur.slice(pos)] : [...cur, ...add] };
    db.occurrences.set(id, next);
    return next;
  }
  if (update?.$addToSet) {
    if (!prev) return null;
    const spec = update.$addToSet.occurrences;
    const each = spec?.$each ?? [spec];
    const cur = [...(prev.occurrences || [])];
    const add = each.filter((c) => !cur.includes(c));
    if (!add.length) return prev;
    const next = { ...prev, occurrences: [...cur, ...add] };
    db.occurrences.set(id, next);
    return next;
  }
  const next = { ...(prev || { id }), ...(update.$set || update) };
  db.occurrences.set(id, next);
  return next;
};

vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOne: vi.fn(({ id }) => ({ lean: () => { trips.read++; trips.total++; return delayed(1, db.occurrences.get(id) || null); } })),
    find: vi.fn((filter) => {
      const q = {
        setOptions: () => q,
        lean: async () => {
          trips.read++; trips.total++; await delayed(1);
          const ids = filter?.id?.$in || [];
          return ids.map((i) => db.occurrences.get(i)).filter(Boolean);
        },
      };
      return q;
    }),
    findOneAndDelete: vi.fn(async ({ id }) => { db.occurrences.delete(id); return null; }),
    bulkWrite: vi.fn(async (ops, opts = {}) => {
      trips.bulk++; trips.total++;
      await delayed(1);
      if (opts.signal?.aborted) throw new AbortError();
      for (const op of ops) {
        const o = op.updateOne || op.replaceOne;
        if (!o) continue;
        const id = o.filter.id;
        if (op.replaceOne) db.occurrences.set(id, o.replacement);
        else applyUpdate(id, o.update);
      }
      return { ok: 1, nMatched: ops.length };
    }),
    findOneAndUpdate: vi.fn(async (filter, update, opts = {}) => {
      if (update?.$push || update?.$addToSet) { trips.push++; } else { trips.upsert++; }
      trips.total++;
      await delayed(1);
      if (opts.signal?.aborted) throw new AbortError();
      const id = filter.id;
      if ((update?.$push || update?.$addToSet) && filter.occurrences?.$ne) {
        const prev = db.occurrences.get(id);
        if (prev && (prev.occurrences || []).includes(filter.occurrences.$ne)) return null;
      }
      return applyUpdate(id, update);
    }),
  },
}));

vi.mock("../models/Grid.js", () => ({
  default: { findOne: vi.fn(() => ({ lean: () => delayed(1, null) })), findOneAndUpdate: vi.fn(() => delayed(1, null)) },
}));
for (const m of ["Module", "View", "Folder", "Manifest", "Field", "Operation"]) {
  vi.doMock(`../models/${m}.js`, () => ({ default: {} }));
}
vi.mock("../models/Module.js", () => ({ default: {} }));
vi.mock("../models/View.js", () => ({ default: {} }));
vi.mock("../models/Folder.js", () => ({ default: {} }));
vi.mock("../models/Manifest.js", () => ({ default: {} }));
vi.mock("../models/Field.js", () => ({ default: {} }));
vi.mock("../models/Operation.js", () => ({ default: {} }));
vi.mock("../services/thumbnailService.js", () => ({ invalidateThumbnail: vi.fn() }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: vi.fn(), flushAction: vi.fn(), flushAll: vi.fn() }));

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");

describe("the create burst", () => {
  let handlers, uc, socket, emitted;

  const fire = (event) => {
    const fns = handlers.get(event) || [];
    return (...args) => Promise.all(fns.map((fn) => fn(...args)));
  };

  beforeEach(() => {
    db.occurrences.clear();
    Object.keys(trips).forEach((k) => { trips[k] = 0; });
    handlers = new Map();
    emitted = [];
    const parent = { id: "day-col", userId: "u1", parentId: null, occurrences: [] };
    db.occurrences.set("day-col", { ...parent });
    uc = { occurrencesById: { "day-col": { ...parent } }, modulesById: {}, viewsById: {},
      foldersById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} };
    socket = {
      id: "s1", userId: "u1", data: { activeGridId: "g1" },
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: (e, p) => emitted.push([e, p]) }),
    };
    registerCrudHandlers(socket, {
      ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: vi.fn(),
      getAllGridsForUser: vi.fn(async () => []), userRoom: (u) => `user:${u}`,
      gridRoom: (g) => `grid:${g}`, getOccurrencesForGrid: vi.fn(() => []),
      createOccurrenceData: vi.fn((o) => o),
    });
  });

  const slot = (n) => ({ id: `slot-${String(n).padStart(2, "0")}`, userId: "u1", gridId: "g1",
    moduleId: "m-slot", parentId: "day-col", fields: {} });

  const burst = async (n = 49) => {
    const create = fire("create_occurrence");
    const all = [];
    for (let i = 0; i < n; i++) all.push(create({ occurrence: slot(i) }));
    await Promise.all(all);
    await delayed(30);            // let any coalescing window close
  };

  it("persists all 49 rows", async () => {
    await burst();
    expect(db.occurrences.size).toBe(50);            // 49 slots + the parent
  });

  it("lists them on the parent in EMIT ORDER — what the serialization protected", async () => {
    await burst();
    const kids = db.occurrences.get("day-col").occurrences;
    expect(kids).toHaveLength(49);
    expect(kids).toEqual([...kids].sort());          // slot-00 … slot-48, in order
  });

  it("costs a bounded number of Atlas round trips, not two per create", async () => {
    await burst();
    // The whole point. Before batching this was 98 — 49 upserts + 49 parent
    // pushes, serialized. Now: 2 bulkWrites + 2 reads.
    expect(trips.total).toBeLessThanOrEqual(6);
    expect(trips.upsert + trips.push).toBe(0);      // nothing goes one at a time
  });

  // The invariant that actually matters, and the one a fixed number cannot
  // state: the cost of a burst no longer scales with its size. This is what
  // collapses the vulnerable drain window a pm2 restart truncates.
  it("costs the same whether the burst is 5 creates or 50", async () => {
    await burst(5);
    const small = trips.total;
    db.occurrences.clear();
    db.occurrences.set("day-col", { id: "day-col", userId: "u1", parentId: null, occurrences: [] });
    Object.keys(trips).forEach((k) => { trips[k] = 0; });
    await burst(50);
    expect(trips.total).toBe(small);
  });

  it("is idempotent — replaying the same burst does not double-list", async () => {
    await burst();
    await burst();
    expect(db.occurrences.get("day-col").occurrences).toHaveLength(49);
  });

  it("still honours insertAtIndex", async () => {
    const create = fire("create_occurrence");
    await create({ occurrence: slot(1) });
    await create({ occurrence: slot(2) });
    await delayed(30);
    await create({ occurrence: { ...slot(9), insertAtIndex: 1 } });
    await delayed(30);
    expect(db.occurrences.get("day-col").occurrences)
      .toEqual(["slot-01", "slot-09", "slot-02"]);
  });

  it("writes nothing to Atlas when the socket is already gone", async () => {
    fire("disconnect")();
    await burst(10);
    expect(trips.total).toBe(0);
    expect(db.occurrences.size).toBe(1);             // the parent only
  });

  it("leaves no phantom in the warm cache for rows that never persisted", async () => {
    const create = fire("create_occurrence");
    const inFlight = Promise.all([create({ occurrence: slot(1) }), create({ occurrence: slot(2) })]);
    await delayed(0);
    fire("disconnect")();
    await inFlight;
    await delayed(30);
    for (const id of ["slot-01", "slot-02"]) {
      if (!db.occurrences.has(id)) expect(uc.occurrencesById[id]).toBeUndefined();
    }
  });
});
