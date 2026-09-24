// server/__tests__/apiShare.test.js — POST /api/v1/share, driven through the
// REAL router (router.handle, as apiIngest.test.js does) with the engine and
// models mocked. What it pins is the ROUTE's own contract: grid resolution,
// ownership, the catch-all being ensured before rules run, and that a share
// which lands nowhere is never reported as a success.
import { describe, it, expect, beforeEach, vi } from "vitest";

const grids = new Set(["g1"]);
let userMeta = {};
const logged = [];
vi.mock("../models/Grid.js", () => ({ default: {
  exists: async (q) => (grids.has(q._id) && q.userId === "u1" ? { _id: q._id } : null),
  findOneAndUpdate: (q, u) => { logged.push(u.$push.shareLog.$each[0]); return { lean: async () => ({ shareLog: [] }) }; },
}}));
vi.mock("../models/User.js", () => ({ default: {
  findById: () => ({ lean: async () => ({ _id: "u1", meta: userMeta }) }),
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: () => ({ lean: async () => null }),
  updateOne: async () => ({}),
}}));
vi.mock("../models/Module.js", () => ({ default: {} }));

const calls = [];
let ensureThrows = false;
vi.mock("../utils/shareRulesEnsure.js", () => ({
  ensureCatchAllRule: async (a) => {
    calls.push(["ensure", a.gridId]);
    if (ensureThrows) throw new Error("this grid has no Files folder, so a share has nowhere to land");
    return { created: false };
  },
}));
let ruleResult = { ran: [{ ruleId: "r1", ok: true, created: [{ _effect: "CREATE", occurrenceId: "o1" }] }], halted: false };
vi.mock("../services/shareRules.js", () => ({
  runShareRules: async (a) => { calls.push(["rules", a.share, typeof a.mirror]); return ruleResult; },
}));
vi.mock("../utils/linkPreview.js", () => ({
  fetchLinkPreview: async (url) => ({ ok: true, url, title: "Fetched Title", favicon: null, cover: null }),
}));
vi.mock("../utils/safeFetchUrl.js", () => ({ fetchPageHtml: async () => ({}) }));

const { makeApiV1Router } = await import("../routes/apiV1.js");

function makeRouter(extra = {}) {
  return makeApiV1Router({
    ...extra,
    getUserCache: async () => ({ _loaded: true, occurrencesById: {}, modulesById: {} }),
    peekUserCache: () => null,
    io: { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: new Map() } } },
    userRoom: (u) => `user:${u}`,
    opRunBridge: { await: async () => ({}) },
  });
}
function call(router, body, reqExtra = {}) {
  return new Promise((resolve) => {
    const req = {
      ...reqExtra,
      method: "POST", url: "/share", originalUrl: "/share", path: "/share",
      headers: { "content-type": "application/json" },
      apiToken: { tokenId: "t1", scopes: ["read", "write"] },
      userId: "u1", body, query: {}, params: {}, get: () => undefined,
    };
    let statusCode = 200;
    const res = {
      status(c) { statusCode = c; return this; },
      json(payload) { resolve({ status: statusCode, body: payload }); return this; },
      send(payload) { resolve({ status: statusCode, body: payload }); return this; },
      setHeader() { return this; }, getHeader() { return null; },
      end() { resolve({ status: statusCode, body: null }); return this; },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

beforeEach(() => {
  logged.length = 0;
  calls.length = 0; userMeta = {}; ensureThrows = false;
  ruleResult = { ran: [{ ruleId: "r1", ok: true, created: [{ _effect: "CREATE", occurrenceId: "o1" }] }], halted: false };
});

describe("POST /share", () => {
  it("ensures the catch-all, THEN runs the rules with a prepared $share", async () => {
    const r = await call(makeRouter(), { gridId: "g1", url: "https://x.test/a", shape: "page", source: "extension" });
    expect(r.status).toBe(201);
    expect(calls.map(c => c[0])).toEqual(["ensure", "rules"]);
    const share = calls[1][1];
    expect(share.type).toBe("link");
    expect(share.label).toBe("Fetched Title");
    expect(share.externalId).toBe("page:https://x.test/a");
    expect(share.source).toBe("extension");
    expect(calls[1][2]).toBe("function"); // the warm-cache mirror is supplied
  });

  it("falls back to the user's share grid (D10)", async () => {
    userMeta = { share: { gridId: "g1" } };
    const r = await call(makeRouter(), { url: "https://x.test/a" });
    expect(r.status).toBe(201);
    expect(r.body.gridId).toBe("g1");
  });

  it("with no grid named and none configured, refuses", async () => {
    const r = await call(makeRouter(), { url: "https://x.test/a" });
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses a grid the caller does not own, before writing anything", async () => {
    const r = await call(makeRouter(), { gridId: "someone-elses", url: "https://x.test/a" });
    expect(r.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("a grid with nowhere to land says so (409), and runs no rule", async () => {
    ensureThrows = true;
    const r = await call(makeRouter(), { gridId: "g1", url: "https://x.test/a" });
    expect(r.status).toBe(409);
    expect(r.body.error?.message || JSON.stringify(r.body)).toMatch(/Files folder/);
    expect(calls.map(c => c[0])).toEqual(["ensure"]);
  });

  it("a share that created nothing because a rule failed is NOT a success", async () => {
    ruleResult = { ran: [{ ruleId: "r1", ok: false, error: { message: "boom" }, created: [] }], halted: false };
    const r = await call(makeRouter(), { gridId: "g1", url: "https://x.test/a" });
    expect(r.status).toBe(502);
  });

  it("requires something to share", async () => {
    const r = await call(makeRouter(), { gridId: "g1" });
    expect(r.status).toBe(400);
  });
});

describe("POST /share — every outcome is logged (D16, §12)", () => {
  it("a landed share", async () => {
    await call(makeRouter(), { gridId: "g1", url: "https://x.test/a" });
    expect(logged).toHaveLength(1);
    expect(logged[0].status).toBe("landed");
    expect(logged[0].type).toBe("link");
  });
  it("a share with nowhere to land", async () => {
    ensureThrows = true;
    await call(makeRouter(), { gridId: "g1", url: "https://x.test/a" });
    expect(logged[0].status).toBe("failed");
    expect(logged[0].error).toMatch(/Files folder/);
  });
  it("NOT for a grid the caller does not own — nothing to write it on", async () => {
    await call(makeRouter(), { gridId: "someone-elses", url: "https://x.test/a" });
    expect(logged).toHaveLength(0);
  });
});

// A SHARED FILE. multer is stubbed (it cannot run on a hand-built request), so
// what is pinned is the route's side: the file goes through the injected
// uploader BEFORE the rules, extras are removed, and oversize says so.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmpFile = (name, bytes = "photo bytes") => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "share-")), name);
  fs.writeFileSync(p, bytes);
  return { path: p, originalname: name, mimetype: "image/jpeg", size: bytes.length, fieldname: "files" };
};
const multipart = { is: (t) => t === "multipart/form-data" };
const fakeMulter = (files, error = null) => ({ any: () => (req, _res, next) => { if (!error) req.files = files; next(error); } });

describe("POST /share — a file", () => {
  it("stores the file through the ONE uploader before the rules run, and logs it as landed", async () => {
    const stored = [];
    const f = tmpFile("photo.jpg");
    const router = makeRouter({
      shareUpload: fakeMulter([f]),
      storeUploadedFile: async ({ file }) => { stored.push(file.path); return { occurrence: { id: "file-occ", meta: {} }, fileRef: "user/2026-09/photo.jpg" }; },
    });
    const r = await call(router, { gridId: "g1", source: "android" }, multipart);
    expect(r.status).toBe(201);
    expect(stored).toEqual([f.path]);
    expect(r.body.fileOccurrenceId).toBe("file-occ");
    const share = calls.find(c => c[0] === "rules")[1];
    expect(share.type).toBe("image");
    expect(share.props.occurrenceId).toBe("file-occ");
    expect(share.externalId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(logged[0].status).toBe("landed");
  });

  it("only the first file is the share; the others are removed and reported", async () => {
    const a = tmpFile("a.jpg", "a"), b = tmpFile("b.jpg", "b");
    const router = makeRouter({
      shareUpload: fakeMulter([a, b]),
      storeUploadedFile: async () => ({ occurrence: { id: "o", meta: {} }, fileRef: "x" }),
    });
    const r = await call(router, { gridId: "g1" }, multipart);
    expect(r.body.ignoredFiles).toEqual(["b.jpg"]);
    expect(fs.existsSync(b.path)).toBe(false);
  });

  it("an oversized file is refused with a 413 that names the limit", async () => {
    const tooBig = Object.assign(new Error("File too large"), { code: "LIMIT_FILE_SIZE" });
    const router = makeRouter({ shareUpload: fakeMulter([], tooBig), storeUploadedFile: async () => ({}) });
    const r = await call(router, { gridId: "g1" }, multipart);
    expect(r.status).toBe(413);
    expect(r.body.message).toMatch(/500 MB/);
    expect(calls).toHaveLength(0);
  });

  it("a file sent to a grid the caller does not own is refused AND its temp file removed", async () => {
    const f = tmpFile("x.jpg");
    const router = makeRouter({ shareUpload: fakeMulter([f]), storeUploadedFile: async () => ({}) });
    const r = await call(router, { gridId: "someone-elses" }, multipart);
    expect(r.status).toBe(404);
    expect(fs.existsSync(f.path)).toBe(false);
  });
});
