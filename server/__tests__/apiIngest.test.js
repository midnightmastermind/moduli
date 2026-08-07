// __tests__/apiIngest.test.js — the REST write path's three invariants.
//
// Three defects found 2026-08-07 while designing external-data ingestion
// (docs/data-ingestion-guide.md). All three made a REST-written row look
// stored while being absent, invisible, or duplicated:
//
//   1. NOT LINKED. `POST /occurrences` set `parentId` and stopped. Every
//      renderer reads the PARENT's `occurrences[]`, so the row existed in the
//      database and never appeared on screen — the "created-but-unlinked"
//      class this repo has swept repeatedly.
//   2. NOT MIRRORED. `request_full_state` is served entirely from the warm
//      per-(user,grid) cache, which lives 30 minutes. A write that reached only
//      Mongo was invisible until that expired, and the socket write path — which
//      merges over the cached copy — could republish the stale row on top of it.
//   3. NOT IDEMPOTENT. There was no intake route at all: producers had to use
//      the raw CRUD endpoints, so any retry or re-run duplicated data.
//
// These drive the REAL router (via `router.handle`, the same in-process
// dispatch the /batch endpoint uses) with the models mocked. No database.
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── In-memory stand-in for Mongo ────────────────────────────────────────
const db = { occurrences: new Map(), modules: new Map() };

// Filter matcher covering the shapes these routes actually use: scalar
// equality, dotted meta paths, and the occurrences[] membership guards that
// make the parent link idempotent.
function matches(doc, filter = {}) {
  if (!doc) return false;
  for (const [k, v] of Object.entries(filter)) {
    if (k === "occurrences") {
      const list = doc.occurrences || [];
      if (v && typeof v === "object" && "$ne" in v) {
        if (list.includes(v.$ne)) return false;
      } else if (!list.includes(v)) return false;
      continue;
    }
    const actual = k.includes(".")
      ? k.split(".").reduce((o, part) => (o == null ? o : o[part]), doc)
      : doc[k];
    if (actual !== v) return false;
  }
  return true;
}

function findIn(store, filter) {
  for (const doc of store.values()) if (matches(doc, filter)) return doc;
  return null;
}

function applyUpdate(prev, update) {
  let next = { ...prev };
  if (update.$set) next = { ...next, ...update.$set };
  if (update.$push) {
    const spec = update.$push.occurrences;
    const list = [...(next.occurrences || [])];
    if (spec && typeof spec === "object" && spec.$each) {
      const pos = spec.$position;
      if (Number.isInteger(pos)) list.splice(pos, 0, ...spec.$each);
      else list.push(...spec.$each);
    } else list.push(spec);
    next.occurrences = list;
  }
  if (update.$pull) {
    next.occurrences = (next.occurrences || []).filter(x => x !== update.$pull.occurrences);
  }
  if (!update.$set && !update.$push && !update.$pull) next = { ...next, ...update };
  return next;
}

function makeModelMock(store) {
  return {
    findOne: vi.fn((filter) => {
      const doc = findIn(store, filter);
      const result = doc ? { ...doc } : null;
      // Supports both `.lean()` and a bare await.
      return Object.assign(Promise.resolve(result), { lean: () => Promise.resolve(result) });
    }),
    exists: vi.fn(async (filter) => (findIn(store, filter) ? { _id: "x" } : null)),
    create: vi.fn(async (data) => {
      if (store.has(data.id)) {
        const e = new Error("E11000 duplicate key"); e.code = 11000; throw e;
      }
      const doc = { ...data };
      store.set(data.id, doc);
      return { ...doc, toObject: () => ({ ...doc }) };
    }),
    findOneAndUpdate: vi.fn(async (filter, update) => {
      const doc = findIn(store, filter);
      if (!doc) return null;
      const next = applyUpdate(doc, update);
      store.set(next.id, next);
      return { ...next };
    }),
    findOneAndDelete: vi.fn(async (filter) => {
      const doc = findIn(store, filter);
      if (!doc) return null;
      store.delete(doc.id);
      return { ...doc };
    }),
    find: vi.fn(() => ({ sort: () => ({ lean: () => Promise.resolve([...store.values()]) }) })),
  };
}

vi.mock("../models/Occurrence.js", () => ({ default: makeModelMock(db.occurrences) }));
vi.mock("../models/Module.js", () => ({ default: makeModelMock(db.modules) }));

const { makeApiV1Router } = await import("../routes/apiV1.js");

// ── Harness ────────────────────────────────────────────────────────────
const USER = "u1";
const GRID = "g1";

let warmCache;
let emitted;

function makeRouter({ warm = true } = {}) {
  emitted = [];
  warmCache = {
    _loaded: true,
    occurrencesById: {}, modulesById: {}, fieldsById: {},
    viewsById: {}, foldersById: {}, manifestsById: {}, operationsById: {},
  };
  return makeApiV1Router({
    getUserCache: async () => warmCache,
    peekUserCache: () => (warm ? warmCache : null),
    io: { to: () => ({ emit: (ev, payload) => emitted.push({ ev, payload }) }), sockets: { adapter: { rooms: new Map() } } },
    userRoom: (u) => `user:${u}`,
    opRunBridge: { await: async () => ({}) },
  });
}

function call(router, method, path, body = {}) {
  return new Promise((resolve) => {
    const req = {
      method, url: path, originalUrl: path, path: path.split("?")[0],
      headers: { "content-type": "application/json" },
      apiToken: { tokenId: "t1", scopes: ["read", "write"] },
      userId: USER, body, query: {}, params: {},
      get: () => undefined,
    };
    let statusCode = 200;
    const res = {
      get statusCode() { return statusCode; },
      status(c) { statusCode = c; return this; },
      json(payload) { resolve({ status: statusCode, body: payload }); return this; },
      send(payload) { resolve({ status: statusCode, body: payload }); return this; },
      setHeader() { return this; }, getHeader() { return null; },
      end() { resolve({ status: statusCode, body: null }); return this; },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

const seedParent = (id = "parent-1") => {
  db.occurrences.set(id, { id, userId: USER, gridId: GRID, moduleId: "m-box", occurrences: [], meta: {} });
  return id;
};
const seedModule = (id = "m-play") => {
  db.modules.set(id, { id, userId: USER, gridId: GRID, label: "Spotify Play", role: "instance" });
  return id;
};

beforeEach(() => {
  db.occurrences.clear();
  db.modules.clear();
  vi.clearAllMocks();
});

// ── 1. Parent linking ──────────────────────────────────────────────────
describe("POST /occurrences — maintains the parent's render list", () => {
  it("appends the new id to the parent's occurrences[]", async () => {
    const router = makeRouter();
    const parentId = seedParent();
    seedModule();

    const r = await call(router, "POST", "/occurrences", {
      gridId: GRID, moduleId: "m-play", parentId, id: "occ-1", label: "Money Trees",
    });

    expect(r.status).toBe(201);
    // The assertion that discriminates: parentId alone is not enough.
    expect(db.occurrences.get(parentId).occurrences).toEqual(["occ-1"]);
    expect(r.body.linkedToParent).toBe(true);
  });

  it("honours insertAtIndex instead of always appending", async () => {
    const router = makeRouter();
    const parentId = seedParent();
    db.occurrences.get(parentId).occurrences = ["a", "b"];
    seedModule();

    await call(router, "POST", "/occurrences", {
      gridId: GRID, moduleId: "m-play", parentId, id: "occ-mid", insertAtIndex: 1,
    });

    expect(db.occurrences.get(parentId).occurrences).toEqual(["a", "occ-mid", "b"]);
  });

  it("does not persist insertAtIndex onto the occurrence itself", async () => {
    const router = makeRouter();
    const parentId = seedParent();
    seedModule();

    await call(router, "POST", "/occurrences", {
      gridId: GRID, moduleId: "m-play", parentId, id: "occ-1", insertAtIndex: 0,
    });

    expect(db.occurrences.get("occ-1")).not.toHaveProperty("insertAtIndex");
  });

  it("DELETE removes the id from the parent — no dangling child ref", async () => {
    const router = makeRouter();
    const parentId = seedParent();
    seedModule();
    await call(router, "POST", "/occurrences", { gridId: GRID, moduleId: "m-play", parentId, id: "occ-1" });
    expect(db.occurrences.get(parentId).occurrences).toEqual(["occ-1"]);

    await call(router, "DELETE", "/occurrences/occ-1", {});

    expect(db.occurrences.get(parentId).occurrences).toEqual([]);
  });

  it("PATCHing parentId moves the row between both render lists", async () => {
    const router = makeRouter();
    const from = seedParent("from-1");
    const to = seedParent("to-1");
    seedModule();
    await call(router, "POST", "/occurrences", { gridId: GRID, moduleId: "m-play", parentId: from, id: "occ-1" });

    await call(router, "PATCH", "/occurrences/occ-1", { parentId: to });

    expect(db.occurrences.get(from).occurrences).toEqual([]);
    expect(db.occurrences.get(to).occurrences).toEqual(["occ-1"]);
  });
});

// ── 2. Warm-cache mirroring ────────────────────────────────────────────
describe("REST writes mirror into the warm cache full_state is served from", () => {
  it("a created occurrence is in the cache immediately", async () => {
    const router = makeRouter();
    const parentId = seedParent();
    seedModule();

    await call(router, "POST", "/occurrences", { gridId: GRID, moduleId: "m-play", parentId, id: "occ-1" });

    expect(warmCache.occurrencesById["occ-1"]).toBeTruthy();
    // The parent's new occurrences[] must be mirrored too, or the cached
    // parent still renders without the child.
    expect(warmCache.occurrencesById[parentId].occurrences).toEqual(["occ-1"]);
  });

  it("a deleted occurrence is evicted from the cache", async () => {
    const router = makeRouter();
    const parentId = seedParent();
    seedModule();
    await call(router, "POST", "/occurrences", { gridId: GRID, moduleId: "m-play", parentId, id: "occ-1" });

    await call(router, "DELETE", "/occurrences/occ-1", {});

    expect(warmCache.occurrencesById["occ-1"]).toBeUndefined();
  });

  it("skips mirroring when the cache is cold — no full-grid load per write", async () => {
    const router = makeRouter({ warm: false });
    const parentId = seedParent();
    seedModule();

    const r = await call(router, "POST", "/occurrences", { gridId: GRID, moduleId: "m-play", parentId, id: "occ-1" });

    expect(r.status).toBe(201);
    expect(db.occurrences.get("occ-1")).toBeTruthy();   // still written
    expect(warmCache.occurrencesById["occ-1"]).toBeUndefined(); // nothing to correct
  });
});

// ── 3. Ingest ──────────────────────────────────────────────────────────
describe("POST /ingest", () => {
  const record = (over = {}) => ({
    gridId: GRID, source: "raindrop", externalId: "884120391",
    moduleId: "m-play", parentId: "parent-1", label: "Some bookmark",
    ...over,
  });

  it("creates, links, and mirrors in one call", async () => {
    const router = makeRouter();
    seedParent(); seedModule();

    const r = await call(router, "POST", "/ingest", record());

    expect(r.body.summary).toEqual({ created: 1 });
    const occId = r.body.results[0].occurrenceId;
    expect(db.occurrences.get(occId).meta).toMatchObject({ source: "raindrop", externalId: "884120391" });
    expect(db.occurrences.get("parent-1").occurrences).toEqual([occId]);
    expect(warmCache.occurrencesById[occId]).toBeTruthy();
  });

  it("is idempotent on (source, externalId) — a re-run creates nothing", async () => {
    const router = makeRouter();
    seedParent(); seedModule();

    const first = await call(router, "POST", "/ingest", record());
    const second = await call(router, "POST", "/ingest", record());

    expect(first.body.summary).toEqual({ created: 1 });
    expect(second.body.summary).toEqual({ skipped: 1 });
    expect(db.occurrences.size).toBe(2); // the parent + exactly one ingested row
    expect(db.occurrences.get("parent-1").occurrences).toHaveLength(1);
  });

  it("the same externalId from a DIFFERENT source is a different record", async () => {
    const router = makeRouter();
    seedParent(); seedModule();

    await call(router, "POST", "/ingest", record());
    const r = await call(router, "POST", "/ingest", record({ source: "plex" }));

    expect(r.body.summary).toEqual({ created: 1 });
  });

  it("onExisting:'update' merges fields; 'skip' leaves them alone", async () => {
    const router = makeRouter();
    seedParent(); seedModule();
    await call(router, "POST", "/ingest", record({ fields: { f1: { value: 1 } } }));

    await call(router, "POST", "/ingest", record({ fields: { f2: { value: 2 } } }));
    const occId = [...db.occurrences.keys()].find(k => k !== "parent-1");
    expect(db.occurrences.get(occId).fields).toEqual({ f1: { value: 1 } });

    await call(router, "POST", "/ingest", record({ onExisting: "update", fields: { f2: { value: 2 } } }));
    expect(db.occurrences.get(occId).fields).toEqual({ f1: { value: 1 }, f2: { value: 2 } });

    await call(router, "POST", "/ingest", record({ onExisting: "replace", fields: { f3: { value: 3 } } }));
    expect(db.occurrences.get(occId).fields).toEqual({ f3: { value: 3 } });
  });

  it("fails a record with an unknown parentId instead of creating an orphan", async () => {
    const router = makeRouter();
    seedModule();

    const r = await call(router, "POST", "/ingest", record({ parentId: "nope" }));

    expect(r.body.ok).toBe(false);
    expect(r.body.results[0]).toMatchObject({ status: "error" });
    expect(db.occurrences.size).toBe(0);
  });

  it("mints the type module once for a whole batch when given moduleLabel", async () => {
    const router = makeRouter();
    seedParent();

    const r = await call(router, "POST", "/ingest", {
      gridId: GRID, source: "spotify", parentId: "parent-1", moduleLabel: "Spotify Play",
      records: [
        { externalId: "a", label: "Track A" },
        { externalId: "b", label: "Track B" },
        { externalId: "c", label: "Track C" },
      ],
    });

    expect(r.body.summary).toEqual({ created: 3 });
    expect(db.modules.size).toBe(1);
    const modId = [...db.modules.keys()][0];
    for (const res of r.body.results) {
      expect(db.occurrences.get(res.occurrenceId).moduleId).toBe(modId);
    }
    expect(db.occurrences.get("parent-1").occurrences).toHaveLength(3);
  });

  it("reuses an existing module rather than minting a duplicate type", async () => {
    const router = makeRouter();
    seedParent(); seedModule("m-existing");

    await call(router, "POST", "/ingest", {
      gridId: GRID, source: "spotify", parentId: "parent-1",
      moduleLabel: "Spotify Play", records: [{ externalId: "a" }],
    });

    expect(db.modules.size).toBe(1);
    expect([...db.modules.keys()][0]).toBe("m-existing");
  });

  it("reports per-record outcomes without failing the whole batch", async () => {
    const router = makeRouter();
    seedParent(); seedModule();

    const r = await call(router, "POST", "/ingest", {
      gridId: GRID, source: "mixed", parentId: "parent-1", moduleId: "m-play",
      records: [{ externalId: "ok-1" }, { /* no externalId */ }, { externalId: "ok-2" }],
    });

    expect(r.body.summary).toEqual({ created: 2, error: 1 });
    expect(db.occurrences.get("parent-1").occurrences).toHaveLength(2);
  });

  it("rejects a batch over the per-request cap", async () => {
    const router = makeRouter();
    const r = await call(router, "POST", "/ingest", {
      gridId: GRID, source: "s",
      records: Array.from({ length: 201 }, (_, i) => ({ externalId: `x${i}` })),
    });
    expect(r.status).toBe(400);
  });

  it("requires gridId and source", async () => {
    const router = makeRouter();
    expect((await call(router, "POST", "/ingest", { source: "s", externalId: "1" })).status).toBe(400);
    expect((await call(router, "POST", "/ingest", { gridId: GRID, externalId: "1" })).status).toBe(400);
  });
});
