// REST writes to operations / folders / views / manifests keep the warm cache
// in step (full_state is served from it). Found 2026-09-24: a share rule made
// through the API ran — the engine reads Mongo — but was missing from the
// Imports tab until a restart.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

const store = { operations: new Map(), folders: new Map() };
const model = (m) => ({ default: {
  create: async (d) => { m.set(d.id, { ...d }); return { ...d, toObject: () => ({ ...d }) }; },
  findOneAndUpdate: async (q, u) => { const o = m.get(q.id); if (!o) return null; Object.assign(o, u.$set); return { ...o }; },
  findOneAndDelete: async (q) => { const o = m.get(q.id); m.delete(q.id); return o || null; },
}});
vi.mock("../models/Operation.js", () => model(store.operations));
vi.mock("../models/Folder.js", () => model(store.folders));
vi.mock("../models/ApiToken.js", () => ({ default: { authenticate: async () => ({ userId: "u1", scopes: ["read", "write"], tokenId: "t" }) } }));

const { makeApiV1Router } = await import("../routes/apiV1.js");
const warm = { operationsById: {}, foldersById: {} };
let server, base;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use("/api/v1", makeApiV1Router({ getUserCache: async () => warm, peekUserCache: (_u, g) => (g === "g1" ? warm : null),
    io: { to: () => ({ emit: () => {} }) }, userRoom: (u) => `user:${u}`, opRunBridge: {} }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server?.close());
const call = (method, path, body) => fetch(base + path, { method, headers: { authorization: "Bearer t", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("REST writes reach the warm cache", () => {
  it("an operation: create mirrors, update mirrors, delete evicts", async () => {
    await call("POST", "/operations", { id: "op1", gridId: "g1", name: "Share: link" });
    expect(warm.operationsById.op1?.name).toBe("Share: link");
    await call("PATCH", "/operations/op1", { name: "Share: links" });
    expect(warm.operationsById.op1?.name).toBe("Share: links");
    await call("DELETE", "/operations/op1");
    expect(warm.operationsById.op1).toBeUndefined();
  });
  it("a folder too", async () => {
    await call("POST", "/folders", { id: "f1", gridId: "g1", name: "Files" });
    expect(warm.foldersById.f1?.name).toBe("Files");
    await call("DELETE", "/folders/f1");
    expect(warm.foldersById.f1).toBeUndefined();
  });
});
