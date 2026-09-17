// __tests__/linkToGrid.test.js — a LINK becomes a bookmark or a page, and
// Jonah can do both.
//
// User, 2026-09-16: *"we also need an audit on jonah and make sure he can do all
// this stuff if i ask (make bookmark occurances out of a link or make its own
// page over it ...). we need to make sure any functionality we added in, jonah
// can utilize"*.
//
// The audit found Jonah had NO tool for either, and the one REST route that
// turned a link into a page (`/import/url`) had drifted from the viewer: its own
// private extraction chain never learned the infobox lead image (2026-09-16 (3))
// and it took no `shape`, so it could only ever mint Magic. These pin the shared
// read, the new `/bookmarks` route, the reader shape being LISTED (not just
// parented), and the tools that call them.
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
    insertMany: vi.fn(async (docs) => { for (const d of docs) store.set(d.id, { ...d }); return docs; }),
    bulkWrite: vi.fn(async () => ({})),
    find: vi.fn(() => ({ sort: () => ({ lean: () => Promise.resolve([...store.values()]) }) })),
  };
}

vi.mock("../models/Occurrence.js", () => ({ default: makeModelMock(db.occurrences) }));
vi.mock("../models/Module.js", () => ({ default: makeModelMock(db.modules) }));
const persistImportResult = vi.fn(async ({ result }) => {
  for (const o of result.occurrences) db.occurrences.set(o.id, { ...o });
  for (const m of result.modules) db.modules.set(m.id, { ...m });
});
vi.mock("../utils/persistImport.js", () => ({ persistImportResult: (...a) => persistImportResult(...a) }));
const fetchPageHtml = vi.fn();
vi.mock("../utils/safeFetchUrl.js", () => ({ fetchPageHtml: (...a) => fetchPageHtml(...a) }));

const { makeApiV1Router } = await import("../routes/apiV1.js");
const { bookmarkRecords, readLinkForImport, isBookmarkableUrl } = await import("../utils/linkImport.js");
const { moduliToolPack } = await import("../services/assistantTools.js");

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


const INFOBOX_PAGE = `<html><head><title>Albert Ellis - Wikipedia</title>
<meta property="og:title" content="Albert Ellis">
<meta property="og:image" content="https://upload.wikimedia.org/ellis.jpg"></head><body>
<div id="mw-content-text">
  <table class="infobox biography vcard"><tbody>
    <tr><td colspan="2"><img src="//thumb.wikimedia.org/ellis/250px-Ellis.jpg" width="250" height="333"></td></tr>
    <tr><th scope="row">Born</th><td>September 27, 1913</td></tr>
  </tbody></table>
  <h2>Early life</h2>
  <p>Albert Ellis was an American psychologist who founded rational emotive behavior therapy, and wrote widely about it.</p>
  <h2>Career</h2>
  <p>He trained in psychoanalysis before breaking from it to develop a more direct and active form of therapy.</p>
</div></body></html>`;

const ok = (html, url = "https://en.wikipedia.org/wiki/Albert_Ellis") => ({ ok: true, html, url });

beforeEach(() => {
  db.occurrences.clear();
  db.modules.clear();
  vi.clearAllMocks();
});

describe("readLinkForImport — the same read the viewer does", () => {
  it("keeps the infobox lead image the old import chain dropped", async () => {
    fetchPageHtml.mockResolvedValue(ok(INFOBOX_PAGE));
    const r = await readLinkForImport("https://en.wikipedia.org/wiki/Albert_Ellis", { fetchPageHtml });
    expect(r.ok).toBe(true);
    expect(r.markdown).toContain("250px-Ellis.jpg");
    // The metadata table itself stays stripped.
    expect(r.markdown).not.toContain("September 27, 1913");
  });

  it("names the page from its <title>, and an explicit title outranks it", async () => {
    fetchPageHtml.mockResolvedValue(ok(INFOBOX_PAGE));
    expect((await readLinkForImport("https://x.org/a", { fetchPageHtml })).title).toBe("Albert Ellis - Wikipedia");
    expect((await readLinkForImport("https://x.org/a", { title: "Mine", fetchPageHtml })).title).toBe("Mine");
  });

  it("hands back the guard's reason when the link cannot be read", async () => {
    fetchPageHtml.mockResolvedValue({ ok: false, reason: "timed out" });
    expect(await readLinkForImport("https://x.org/a", { fetchPageHtml })).toEqual({ ok: false, reason: "timed out" });
  });
});

describe("bookmarkRecords — the server twin of addBookmarkOccurrence", () => {
  let n = 0;
  const newId = () => `id-${++n}`;

  it("carries exactly the keys the bookmark renderer reads", () => {
    const { module, occurrence } = bookmarkRecords({
      gridId: "g", userId: "u", url: "https://www.example.com/a", parentId: "p",
      preview: { ok: true, title: "A page", cover: "https://example.com/c.jpg" }, newId,
    });
    expect(module).toMatchObject({ role: "artifact", kind: "bookmark", fileRef: "https://www.example.com/a", label: "A page" });
    expect(module.meta).toEqual({ external: true, cover: "https://example.com/c.jpg" });
    expect(occurrence).toMatchObject({ moduleId: module.id, parentId: "p", meta: { url: "https://www.example.com/a" } });
  });

  it("a dead site is still a bookmark, named for its host", () => {
    const { module } = bookmarkRecords({
      gridId: "g", userId: "u", url: "https://www.example.com/a", preview: { ok: false }, newId,
    });
    expect(module.label).toBe("example.com");
    expect(module.meta).toEqual({ external: true });
  });

  it("a name somebody typed outranks the page's title", () => {
    const { module } = bookmarkRecords({
      gridId: "g", userId: "u", url: "https://example.com", label: "Mine",
      preview: { ok: true, title: "Theirs" }, newId,
    });
    expect(module.label).toBe("Mine");
  });

  it("only web addresses are bookmarkable", () => {
    expect(isBookmarkableUrl("https://a.org")).toBe(true);
    expect(isBookmarkableUrl("javascript:alert(1)")).toBe(false);
    expect(isBookmarkableUrl("not a url")).toBe(false);
  });
});

const seedParent = (id = "box") => {
  db.occurrences.set(id, { id, userId: USER, gridId: GRID, moduleId: "m-box", occurrences: [], meta: {} });
  return id;
};

describe("POST /bookmarks", () => {
  it("mints a titled, covered bookmark LISTED in its parent", async () => {
    fetchPageHtml.mockResolvedValue(ok(INFOBOX_PAGE));
    const router = makeRouter();
    const parentId = seedParent();
    const r = await call(router, "POST", "/bookmarks", { gridId: GRID, url: "https://en.wikipedia.org/wiki/Albert_Ellis", parentId });
    expect(r.status).toBe(201);
    expect(r.body.title).toBe("Albert Ellis");
    expect(r.body.cover).toBe("https://upload.wikimedia.org/ellis.jpg");
    expect(db.occurrences.get(parentId).occurrences).toEqual([r.body.occurrence.id]);
    // Mirrored, or the next page load serves a grid without it.
    expect(warmCache.modulesById[r.body.module.id]).toBeTruthy();
  });

  it("refuses a non-web address before fetching anything", async () => {
    const router = makeRouter();
    const r = await call(router, "POST", "/bookmarks", { gridId: GRID, url: "file:///etc/passwd" });
    expect(r.status).toBe(400);
    expect(fetchPageHtml).not.toHaveBeenCalled();
  });

  it("refuses a parent that does not exist rather than minting an orphan", async () => {
    const router = makeRouter();
    const r = await call(router, "POST", "/bookmarks", { gridId: GRID, url: "https://a.org", parentId: "nope" });
    expect(r.status).toBe(404);
    expect(db.modules.size).toBe(0);
  });
});

describe("POST /import/url — shape, and the reader root is LISTED", () => {
  it("reader shape: one container + one textblock, listed in its destination", async () => {
    fetchPageHtml.mockResolvedValue(ok(INFOBOX_PAGE));
    const router = makeRouter();
    const parentId = seedParent();
    const r = await call(router, "POST", "/import/url", { gridId: GRID, url: "https://en.wikipedia.org/wiki/Albert_Ellis", parentId, shape: "reader" });
    expect(r.status).toBe(200);
    expect(r.body.shape).toBe("reader");
    expect(r.body.occurrences.length).toBe(2);
    // The discriminating assertion: the reader planner does not push its own
    // root, so without the link the page lands complete and invisible.
    expect(db.occurrences.get(parentId).occurrences).toContain(r.body.rootOccurrenceId);
  });

  it("magic is the default, and it is a different (bigger) tree", async () => {
    fetchPageHtml.mockResolvedValue(ok(INFOBOX_PAGE));
    const router = makeRouter();
    const r = await call(router, "POST", "/import/url", { gridId: GRID, url: "https://en.wikipedia.org/wiki/Albert_Ellis" });
    expect(r.body.error, JSON.stringify(r.body)).toBeUndefined();
    expect(r.body.shape).toBe("magic");
    expect(r.body.occurrences.length).toBeGreaterThan(2);
    expect(r.body.source.title).toBe("Albert Ellis - Wikipedia");
  });

  it("a dry run persists nothing and returns no root id", async () => {
    fetchPageHtml.mockResolvedValue(ok(INFOBOX_PAGE));
    const router = makeRouter();
    const r = await call(router, "POST", "/import/url", { gridId: GRID, url: "https://a.org", dryRun: true });
    expect(r.body.rootOccurrenceId).toBeNull();
    expect(persistImportResult).not.toHaveBeenCalled();
  });
});

// ── Jonah's tools ─────────────────────────────────────────────────────
describe("Jonah — link tools and the list-write fixes", () => {
  let requests;
  let responder;
  beforeEach(() => {
    requests = [];
    responder = () => ({ status: 200, body: {} });
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const path = String(url).replace("http://api/api/v1", "");
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ method: init.method, path, body });
      const out = responder({ method: init.method, path, body });
      return { status: out.status, text: async () => JSON.stringify(out.body) };
    });
  });
  const tools = () => Object.fromEntries(moduliToolPack({ baseUrl: "http://api", apiToken: "t", gridId: GRID }).map(t => [t.name, t]));

  it("save_bookmark posts to /bookmarks and confirms first", async () => {
    responder = () => ({ status: 201, body: { occurrence: { id: "o1" }, title: "A", cover: null, reachable: true, linkedToParent: true } });
    const t = tools().save_bookmark;
    expect(t.requires_confirm).toBe(true);
    const out = await t.run({ url: "https://a.org", parentId: "box" });
    expect(requests).toEqual([{ method: "POST", path: "/bookmarks", body: { gridId: GRID, url: "https://a.org", parentId: "box", label: null } }]);
    expect(out).toMatchObject({ ok: true, occurrenceId: "o1", title: "A" });
  });

  it("save_bookmark surfaces a refusal as an error, not a success", async () => {
    responder = () => ({ status: 400, body: { error: "validation_error", message: "url must be an http(s) address" } });
    expect(await tools().save_bookmark.run({ url: "x" })).toEqual({ error: "url must be an http(s) address" });
  });

  it("import_url passes the shape and drops the planned rows from what the model sees", async () => {
    responder = () => ({ status: 200, body: { rootOccurrenceId: "r1", shape: "reader", occurrences: new Array(500).fill({}), modules: [], stats: {} } });
    const out = await tools().import_url.run({ url: "https://a.org", shape: "reader" });
    expect(requests[0].body).toMatchObject({ url: "https://a.org", shape: "reader", gridId: GRID });
    expect(out.rootOccurrenceId).toBe("r1");
    expect(out.occurrences).toBeUndefined();
  });

  it("create_occurrence mints no inert kind and never rewrites the parent's list", async () => {
    responder = ({ path }) => path === "/modules"
      ? { status: 201, body: { module: { id: "m1" } } }
      : { status: 201, body: { occurrence: { id: "o1" }, linkedToParent: true } };
    const out = await tools().create_occurrence.run({ label: "Task", parentId: "box" });
    expect(requests.find(r => r.path === "/modules").body).not.toHaveProperty("kind");
    // POST /occurrences already $pushes; a second whole-array PATCH raced it.
    expect(requests.filter(r => r.method === "PATCH")).toEqual([]);
    expect(out.linkedToParent).toBe(true);
  });

  it("move_occurrence across parents is ONE parentId patch — no list rewrites", async () => {
    responder = ({ method, path }) => {
      if (method === "GET" && path === "/occurrences/o1") return { status: 200, body: { occurrence: { id: "o1", parentId: "old" } } };
      if (method === "GET") return { status: 200, body: { occurrence: { id: "new", occurrences: ["x"] } } };
      return { status: 200, body: { occurrence: { id: "o1", parentId: "new" } } };
    };
    await tools().move_occurrence.run({ id: "o1", toParentId: "new", index: 0 });
    const patches = requests.filter(r => r.method === "PATCH");
    expect(patches).toEqual([{ method: "PATCH", path: "/occurrences/o1", body: { parentId: "new", insertAtIndex: 0 } }]);
  });

  it("both link tools reach the offline (local-model) tool set", async () => {
    const { selectToolsForBackend } = await import("../services/assistantAgent.js");
    const names = selectToolsForBackend(Object.values(tools()), "ollama").map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(["save_bookmark", "import_url"]));
  });
});
