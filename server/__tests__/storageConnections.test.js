// Storage connections (plan 2026-09-24-connections-storage-gdrive, Task 3):
// the service, the registry's choice of backend, and the REST routes.
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";

const rows = new Map();          // Connection rows by id
const users = new Map();         // user meta by id
const set = (obj, dotted, v) => { const ks = dotted.split("."); let o = obj; ks.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; }); o[ks.at(-1)] = v; };
const unset = (obj, dotted) => { const ks = dotted.split("."); let o = obj; for (const k of ks.slice(0, -1)) { o = o?.[k]; if (!o) return; } delete o[ks.at(-1)]; };
const q = (v) => Object.assign(Promise.resolve(v), { lean: async () => v, catch: (f) => Promise.resolve(v).catch(f) });

vi.mock("../models/Connection.js", () => ({ default: {
  find: ({ userId }) => ({ sort: () => ({ lean: async () => [...rows.values()].filter(r => r.userId === userId) }) }),
  findOne: ({ id, userId }) => q([...rows.values()].find(r => r.id === id && r.userId === userId) || null),
  exists: async ({ id, userId }) => [...rows.values()].some(r => r.id === id && r.userId === userId) || null,
  findOneAndUpdate: ({ id, userId }, { $set }) => { const r = [...rows.values()].find(x => x.id === id && x.userId === userId); if (r) Object.assign(r, $set); return q(r || null); },
  deleteOne: async ({ id, userId }) => { const r = [...rows.values()].find(x => x.id === id && x.userId === userId); if (r) rows.delete(r.id); return { deletedCount: r ? 1 : 0 }; },
}}));
vi.mock("../models/User.js", () => ({ default: {
  findById: (id) => q({ meta: users.get(String(id)) || {} }),
  updateOne: async ({ _id }, op) => { const m = users.get(String(_id)) || {}; for (const [k, v] of Object.entries(op.$set || {})) set({ meta: m }, k, v); for (const k of Object.keys(op.$unset || {})) unset({ meta: m }, k); users.set(String(_id), m); },
}}));
vi.mock("../models/ApiToken.js", () => ({ default: { authenticate: async () => null } }));

const svc = await import("../services/connections.js");
const { signToken } = await import("../utils/jwts.js");
const { makeStorageRegistry } = await import("../services/storage/index.js");

beforeEach(() => {
  rows.clear(); users.clear();
  rows.set("d1", { id: "d1", userId: "u1", type: "gdrive", name: "My Drive", config: { folderId: "F" },
    credentials: { iv: "x", ciphertext: "SECRET", authTag: "y" }, status: "ok", createdAt: new Date(0) });
  rows.set("d9", { id: "d9", userId: "u2", type: "gdrive", name: "Someone else's", config: {}, status: "ok" });
});

describe("services/connections", () => {
  it("lists Server first, the user's own after, Server the default, and never credentials", async () => {
    const out = await svc.listConnections("u1");
    expect(out.connections.map(c => c.id)).toEqual(["server", "d1"]);
    expect(out.defaultConnectionId).toBe("server");
    expect(out.connections[0]).toMatchObject({ isDefault: true, removable: false });
    expect(JSON.stringify(out)).not.toMatch(/SECRET|ciphertext|credentials/);
  });
  it("sets and clears the default; refuses another user's connection", async () => {
    await svc.setDefaultConnection("u1", "d1");
    expect((await svc.listConnections("u1")).defaultConnectionId).toBe("d1");
    await expect(svc.setDefaultConnection("u1", "d9")).rejects.toMatchObject({ status: 404 });
    await svc.setDefaultConnection("u1", "server");
    expect(users.get("u1").storage.defaultConnectionId).toBeUndefined();
  });
  it("removing the default connection sends new uploads back to the Server; Server cannot be removed", async () => {
    await svc.setDefaultConnection("u1", "d1");
    await svc.removeConnection("u1", "d1");
    expect((await svc.listConnections("u1")).defaultConnectionId).toBe("server");
    await expect(svc.removeConnection("u1", "server")).rejects.toMatchObject({ status: 400 });
  });
});

describe("the registry picks the default connection's backend", () => {
  const fakeBackend = { id: "d1", owns: (r) => String(r).startsWith("gdrive:d1:"), urlFor: (r) => `/files/${r}` };
  it("default Server -> Server; default Drive -> the Drive factory's backend", async () => {
    const reg = makeStorageRegistry({ uploadsDir: "/tmp/x", factories: { gdrive: async () => fakeBackend },
      getDefaultConnection: async (u) => svc.getConnection(u, await svc.defaultConnectionId(u)) });
    expect((await reg.backendForUpload("u1")).id).toBe("server");
    await svc.setDefaultConnection("u1", "d1");
    expect(await reg.backendForUpload("u1")).toBe(fakeBackend);
    expect(reg.backendForRef("gdrive:d1:abc")).toBe(fakeBackend);
    expect(reg.backendForRef("user/2026-09/x.png").id).toBe("server");
  });
  it("NEVER loses an upload: no factory, or a factory that throws, falls back to the Server", async () => {
    await svc.setDefaultConnection("u1", "d1");
    const getDefault = async (u) => svc.getConnection(u, await svc.defaultConnectionId(u));
    const noFactory = makeStorageRegistry({ uploadsDir: "/tmp/x", getDefaultConnection: getDefault });
    expect((await noFactory.backendForUpload("u1")).id).toBe("server");
    const throws = makeStorageRegistry({ uploadsDir: "/tmp/x", factories: { gdrive: async () => { throw new Error("revoked"); } }, getDefaultConnection: getDefault });
    expect((await throws.backendForUpload("u1")).id).toBe("server");
  });
});

describe("REST", () => {
  let server, base;
  beforeAll(async () => {
    const { makeApiV1Router } = await import("../routes/apiV1.js");
    const app = express(); app.use(express.json());
    app.use("/api/v1", makeApiV1Router({ getUserCache: async () => ({}), peekUserCache: () => null,
      io: { to: () => ({ emit: () => {} }) }, userRoom: (u) => `user:${u}`, opRunBridge: {} }));
    await new Promise(r => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  afterAll(() => server?.close());
  const call = (method, path, body, user = "u1") => fetch(base + path, { method,
    headers: { authorization: `Bearer ${signToken({ userId: user })}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });

  it("GET lists with the app session; no session is refused", async () => {
    const r = await call("GET", "/connections");
    expect(r.status).toBe(200);
    expect((await r.json()).connections.map(c => c.id)).toEqual(["server", "d1"]);
    expect((await fetch(base + "/connections")).status).toBe(401);
  });
  it("PUT /me/storage sets the default; another user's connection is a 404", async () => {
    expect((await call("PUT", "/me/storage", { defaultConnectionId: "d1" })).status).toBe(200);
    expect(users.get("u1").storage.defaultConnectionId).toBe("d1");
    expect((await call("PUT", "/me/storage", { defaultConnectionId: "d9" })).status).toBe(404);
  });
  it("PATCH renames, DELETE removes; Server is protected; nobody else's", async () => {
    expect((await call("PATCH", "/connections/d1", { name: "Photos" })).status).toBe(200);
    expect(rows.get("d1").name).toBe("Photos");
    expect((await call("DELETE", "/connections/server")).status).toBe(400);
    expect((await call("DELETE", "/connections/d9")).status).toBe(404);
    expect((await call("DELETE", "/connections/d1")).status).toBe(200);
    expect(rows.has("d1")).toBe(false);
  });
});
