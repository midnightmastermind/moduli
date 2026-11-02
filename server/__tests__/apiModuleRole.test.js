// A module's role must be one the app renders. 2026-11-02: Jonah (llama3.2 3B) copied the create_module
// tool's description "panel/container/instance/page/textblock/artifact" into `role`, and POST /modules
// stored it — a module no renderer, integrity rule or picker can recognise.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

const lean = (v) => ({ lean: async () => v });
vi.mock("../models/ApiToken.js", () => ({ default: {
  authenticate: async (raw) => (raw === "moduli_w" ? { tokenId: "w", userId: "u1", scopes: ["read", "write"], revoked: false } : null),
}}));
let created = []; let patched = [];
vi.mock("../models/Module.js", () => ({ default: {
  create: async (doc) => { created.push(doc); return { toObject: () => doc }; },
  findOneAndUpdate: async (q, u) => { patched.push(u.$set); return { id: q.id, gridId: "g1", ...u.$set }; },
  findOne: () => lean(null),
}}));
for (const m of ["Field", "Folder", "View", "Manifest", "Operation", "User", "Grid"]) {
  vi.doMock(`../models/${m}.js`, () => ({ default: { findOne: () => lean(null), findById: () => lean(null) } }));
}

const { makeApiV1Router } = await import("../routes/apiV1.js");
let server, base;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use("/api/v1", makeApiV1Router({ getUserCache: async () => ({}), peekUserCache: () => null,
    io: { to: () => ({ emit: () => {} }) }, userRoom: (u) => `user:${u}`, opRunBridge: {} }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server?.close());
beforeEach(() => { created = []; patched = []; });
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { authorization: "Bearer moduli_w", "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

describe("module role", () => {
  it("refuses a role the app does not have, and writes nothing", async () => {
    const r = await api("POST", "/modules", { gridId: "g1", label: "Quick Links", role: "panel/container/instance/page/textblock/artifact" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
    expect(created).toHaveLength(0);
  });
  it("accepts every real role, and no role at all (control)", async () => {
    for (const role of ["panel", "page", "container", "instance", "textblock", "artifact"]) {
      expect((await api("POST", "/modules", { gridId: "g1", label: "x", role })).status).toBe(201);
    }
    expect((await api("POST", "/modules", { gridId: "g1", label: "x" })).status).toBe(201);
    expect(created).toHaveLength(7);
  });
  it("a PATCH cannot set a bad role either", async () => {
    expect((await api("PATCH", "/modules/m1", { role: "board" })).status).toBe(400);
    expect(patched).toHaveLength(0);
    expect((await api("PATCH", "/modules/m1", { label: "renamed" })).status).toBe(200);
  });
});
