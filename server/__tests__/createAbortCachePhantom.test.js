// __tests__/createAbortCachePhantom.test.js — ROOT CAUSE of the recurring
// `dangling-child-ref` integrity error (swept 2026-07-29, 07-30, 07-31, 08-03,
// 08-04 and never explained until now).
//
// `handleCreateOccurrence` writes the new occurrence into the WARM CACHE
// (`uc.occurrencesById[id] = occurrenceData`) BEFORE the disconnect check and
// BEFORE the Mongo upsert. When a client goes away mid-create, the handler
// bails — the database never gets the row, but the cache entry is left behind.
//
// That alone would be harmless, except for two other facts:
//
//   1. The warm cache SURVIVES a disconnect (server.js stopped evicting it on
//      disconnect; it ages out on a 30-minute TTL), so the next connection from
//      the same user reuses it instead of reloading from the database.
//   2. `update_occurrence` protects the parent's `occurrences[]` by dropping
//      child ids that name no occurrence — and it decides "names no occurrence"
//      by looking in THAT CACHE.
//
// So the phantom launders itself: the guard sees the id in the cache, concludes
// the child is real, and persists a parent listing a child that does not exist.
// That is the dangling ref, and it is why sweeping the database never held —
// the phantom outlived the sweep and the next parent write put the ref back.
//
// Prod logs confirm the shape: `🧹 update_occurrence z9lntG03zNIP: dropped 11
// unknown child id(s)` — the guard catching the phantoms that had already aged
// out, while the still-cached ones sailed through.
//
// Fix: a create that does not reach the database must not leave anything in the
// cache. These tests drive the REAL handler with Mongo mocked; no database.
import { describe, it, expect, vi, beforeEach } from "vitest";

function delayed(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const db = { occurrences: new Map() };

// update_occurrence reads `io.sockets.adapter.rooms` to decide whether this is
// a solo socket. A bare `{ to }` stub makes the handler THROW and return early,
// which would make every assertion below pass vacuously — the exact failure
// mode this repo keeps paying for. Model the room properly.
const makeIo = (roomSize = 1) => ({
  to: () => ({ emit: () => {} }),
  sockets: { adapter: { rooms: new Map([["user:u1", new Set(Array.from({ length: roomSize }, (_, i) => `s${i}`))]]) } },
});

class AbortError extends Error {
  constructor() { super("The operation was aborted"); this.name = "AbortError"; }
}

vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOne: vi.fn(({ id }) => ({ lean: () => delayed(2, db.occurrences.get(id) || null) })),
    // The create path writes in BATCHES (2026-08-20): one bulkWrite for the
    // rows, a find for the parents, one bulkWrite for the appends, a find to
    // re-read them. These mocks must honour the AbortSignal exactly as
    // findOneAndUpdate does below — the whole phantom bug depends on a write
    // being cancelled mid-flight, and a mock that throws TypeError instead
    // would make every assertion here pass for the wrong reason.
    find: vi.fn((filter) => {
      const q = { setOptions: () => q, lean: async () => {
        await delayed(2);
        return (filter?.id?.$in || []).map((i) => db.occurrences.get(i)).filter(Boolean);
      } };
      return q;
    }),
    bulkWrite: vi.fn(async (ops, opts = {}) => {
      await delayed(10);
      if (opts.signal?.aborted) throw new AbortError();
      for (const op of ops) {
        const { filter, update } = op.updateOne;
        const id = filter.id;
        if (update?.$push) {
          const prev = db.occurrences.get(id);
          if (!prev) continue;
          const each = update.$push.occurrences?.$each ?? [update.$push.occurrences];
          const cur = [...(prev.occurrences || [])];
          const add = each.filter((c) => !cur.includes(c));
          if (add.length) db.occurrences.set(id, { ...prev, occurrences: [...cur, ...add] });
        } else {
          db.occurrences.set(id, { ...(db.occurrences.get(id) || { id }), ...(update.$set || update) });
        }
      }
      return { ok: 1 };
    }),
    findOneAndDelete: vi.fn(async ({ id }) => { db.occurrences.delete(id); return null; }),
    // Honours the AbortSignal the way the driver does — this is the behaviour
    // the whole bug depends on.
    findOneAndUpdate: vi.fn(async (filter, update, opts = {}) => {
      await delayed(10);
      if (opts.signal?.aborted) throw new AbortError();
      const id = filter.id;
      if (update?.$push) {
        const prev = db.occurrences.get(id);
        if (!prev) return null;
        const child = update.$push.occurrences?.$each?.[0] ?? update.$push.occurrences;
        if ((prev.occurrences || []).includes(child)) return null;
        const next = { ...prev, occurrences: [...(prev.occurrences || []), child] };
        db.occurrences.set(id, next);
        return next;
      }
      const next = { ...(db.occurrences.get(id) || { id }), ...update };
      db.occurrences.set(id, next);
      return next;
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

const { registerCrudHandlers, setupOccurrencesCRUD } = await import("../socketHandlers/crud.js");
const { registerOccurrenceHandlers } = await import("../socketHandlers/occurrences.js");

describe("a create that never reaches the database must leave nothing in the warm cache", () => {
  let handlers, uc, socket;

  // Invoke every listener registered for an event (see the `on` shim below).
  const fire = (event) => {
    const fns = handlers.get(event) || [];
    if (!fns.length) return undefined;
    return (...args) => Promise.all(fns.map((fn) => fn(...args)));
  };

  beforeEach(() => {
    db.occurrences.clear();
    handlers = new Map();

    // A feed page (the Schedule Table / Schedule Canvas shape) that exists in
    // both the database and the cache.
    const parent = { id: "feed-page", userId: "u1", parentId: null, occurrences: [] };
    db.occurrences.set("feed-page", { ...parent });
    uc = {
      occurrencesById: { "feed-page": { ...parent } },
      modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {},
      fieldsById: {}, operationsById: {}, gridsById: {},
    };

    socket = {
      id: "socket-1", userId: "u1", data: { activeGridId: null },
      // Both handler modules register their OWN `disconnect` listener (each
      // owns an AbortController). Keep every one — overwriting would abort
      // only half the in-flight work and quietly weaken the test.
      on: (event, fn) => handlers.set(event, [...(handlers.get(event) || []), fn]),
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

    // update_occurrence — and its dangling-ref guard — lives here.
    registerOccurrenceHandlers(socket, {
      io: makeIo(),
      ensureUserCache: () => uc,
      userCacheReady: () => true,
      loadUserIntoCache: vi.fn(),
      userRoom: (u) => `user:${u}`,
    });
  });

  const feedCopy = {
    id: "1785806660311-phantom", userId: "u1", gridId: "g1",
    moduleId: "m1", parentId: "feed-page", fields: {},
    meta: { feedSourceId: "src-1" },
  };

  it("disconnecting mid-create leaves no phantom behind", async () => {
    const create = fire("create_occurrence");
    const disconnect = fire("disconnect");
    expect(create).toBeTypeOf("function");
    expect(disconnect).toBeTypeOf("function");

    // Fire the create, then disconnect while the upsert is in flight — a tab
    // closing during feedSync's mint burst.
    const inFlight = create({ occurrence: feedCopy });
    await delayed(2);
    disconnect();
    await inFlight;

    // The row never landed. That part is expected and is not the bug.
    expect(db.occurrences.has(feedCopy.id)).toBe(false);

    // The bug: the cache must not still claim it exists, because
    // update_occurrence's dangling-ref guard trusts the cache.
    expect(uc.occurrencesById[feedCopy.id]).toBeUndefined();
  });

  it("the phantom cannot launder a dangling ref through a LATER connection", async () => {
    const create = fire("create_occurrence");
    const disconnect = fire("disconnect");

    const inFlight = create({ occurrence: feedCopy });
    await delayed(2);
    disconnect();
    await inFlight;

    // The user reloads. A NEW socket, but the SAME warm cache — server.js
    // deliberately stopped evicting it on disconnect, so it is reused for up
    // to 30 minutes rather than being reloaded from the database. This is the
    // step that turns a stale cache entry into persisted corruption.
    const handlers2 = new Map();
    const socket2 = {
      id: "socket-2", userId: "u1", data: { activeGridId: null },
      on: (event, fn) => handlers2.set(event, [...(handlers2.get(event) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };
    registerOccurrenceHandlers(socket2, {
      io: makeIo(),
      ensureUserCache: () => uc,
      userCacheReady: () => true,
      loadUserIntoCache: vi.fn(),
      userRoom: (u) => `user:${u}`,
    });

    // feedSync re-links its copies and echoes the parent list back, still
    // carrying the id of the copy whose create never persisted.
    await handlers2.get("update_occurrence")[0]({
      occurrence: { id: "feed-page", occurrences: [feedCopy.id] },
    });

    const parent = db.occurrences.get("feed-page");
    expect(parent.occurrences).toEqual([]);
  });

  it("a create that DOES persist is cached and linked normally", async () => {
    const create = fire("create_occurrence");
    await create({ occurrence: feedCopy });

    expect(db.occurrences.has(feedCopy.id)).toBe(true);
    expect(uc.occurrencesById[feedCopy.id]).toBeTruthy();
    expect(db.occurrences.get("feed-page").occurrences).toEqual([feedCopy.id]);
  });
});
