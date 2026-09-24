// The /api/v1 gaps closed 2026-09-24, over REAL HTTP with the real auth
// middleware (models faked): single-record reads, share settings, the share
// log, token list/revoke — and webhook secrets never leaving the server.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

const TOKENS = [
  { tokenId: "cur", userId: "u1", name: "chat", scopes: ["read", "write"], revoked: false, createdAt: new Date(2), hash: "H" },
  { tokenId: "old", userId: "u1", name: "cli", scopes: ["read"], revoked: false, createdAt: new Date(1), hash: "H" },
  { tokenId: "theirs", userId: "u2", name: "x", scopes: ["read"], revoked: false, createdAt: new Date(3), hash: "H" },
];
const byQ = (arr, q) => arr.find(d => Object.entries(q).every(([k, v]) => d[k] === v)) || null;
const lean = (v) => ({ lean: async () => v });
vi.mock("../models/ApiToken.js", () => ({ default: {
  authenticate: async (raw) => { const t = TOKENS.find(x => `moduli_${x.tokenId}` === raw && !x.revoked); return t || null; },
  find: (q) => ({ sort: () => lean(TOKENS.filter(t => t.userId === q.userId)) }),
  updateOne: async (q, u) => { const t = byQ(TOKENS, q); if (t) Object.assign(t, u.$set); return { matchedCount: t ? 1 : 0 }; },
}}));
const OPS = [{ id: "op1", userId: "u1", gridId: "g1", name: "Hook", webhookSecret: "s3cret" }];
vi.mock("../models/Operation.js", () => ({ default: {
  findOne: (q) => lean(byQ(OPS, q)),
  find: () => ({ sort: () => lean(OPS.filter(o => o.userId === "u1")) }),
  findOneAndUpdate: async (q, u) => { const o = byQ(OPS, q); if (o) Object.assign(o, u.$set); return o; },
}}));
const one = (rows) => ({ default: { findOne: (q) => lean(byQ(rows, q)) } });
vi.mock("../models/Module.js", () => one([{ id: "m1", userId: "u1", label: "Appointments" }]));
vi.mock("../models/Field.js", () => one([{ id: "f1", userId: "u1", name: "Date" }]));
vi.mock("../models/Folder.js", () => one([{ id: "d1", userId: "u1", name: "Files" }]));
vi.mock("../models/View.js", () => one([]));
vi.mock("../models/Manifest.js", () => one([]));
let USER = { _id: "u1", meta: {} };
vi.mock("../models/User.js", () => ({ default: {
  findById: () => lean(USER),
  updateOne: async (_q, u) => {
    USER = JSON.parse(JSON.stringify(USER)); USER.meta.share = USER.meta.share || {};
    for (const [k, v] of Object.entries(u.$set || {})) USER.meta.share[k.split(".").pop()] = v;
    for (const k of Object.keys(u.$unset || {})) delete USER.meta.share[k.split(".").pop()];
  },
}}));
vi.mock("../models/Grid.js", () => ({ default: {
  exists: async (q) => (q._id === "g1" && q.userId === "u1" ? { _id: "g1" } : null),
  findOne: (q) => lean(q._id === "g1" && q.userId === "u1" ? { shareLog: [{ at: "1", label: "older" }, { at: "2", label: "newer" }] } : null),
}}));

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
beforeEach(() => { USER = { _id: "u1", meta: {} }; TOKENS.forEach(t => { t.revoked = false; }); });

const api = async (method, path, body, token = "moduli_cur") => {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

describe("single-record reads", () => {
  it("module, field and folder by id", async () => {
    expect((await api("GET", "/modules/m1")).body.module.label).toBe("Appointments");
    expect((await api("GET", "/fields/f1")).body.field.name).toBe("Date");
    expect((await api("GET", "/folders/d1")).body.folder.name).toBe("Files");
  });
  it("404 for a missing one — including another user's", async () => {
    expect((await api("GET", "/views/nope")).status).toBe(404);
  });
});

describe("webhook secrets never leave the server", () => {
  it("GET one, the list, and an update all mask it", async () => {
    expect((await api("GET", "/operations/op1")).body.operation.webhookSecret).toBe("***");
    expect((await api("GET", "/operations")).body.operations[0].webhookSecret).toBe("***");
    expect((await api("PATCH", "/operations/op1", { name: "Hook 2" })).body.operation.webhookSecret).toBe("***");
    expect(JSON.stringify((await api("GET", "/operations")).body)).not.toMatch(/s3cret/);
  });
});

describe("share settings (D10)", () => {
  it("sets and reads the share grid and timezone", async () => {
    const r = await api("PATCH", "/me/share", { gridId: "g1", timeZone: "America/Chicago" });
    expect(r.body).toEqual({ gridId: "g1", timeZone: "America/Chicago" });
    expect((await api("GET", "/me/share")).body.timeZone).toBe("America/Chicago");
  });
  it("refuses a grid you do not own and a zone that is not one", async () => {
    expect((await api("PATCH", "/me/share", { gridId: "g-other" })).status).toBe(404);
    expect((await api("PATCH", "/me/share", { timeZone: "Mars/Olympus" })).status).toBe(400);
  });
  it("null clears a setting", async () => {
    await api("PATCH", "/me/share", { gridId: "g1" });
    expect((await api("PATCH", "/me/share", { gridId: null })).body.gridId).toBe(null);
  });
});

describe("recent shares", () => {
  it("newest first, and only for your grid", async () => {
    expect((await api("GET", "/grids/g1/shares")).body.shares.map(s => s.label)).toEqual(["newer", "older"]);
    expect((await api("GET", "/grids/g9/shares")).status).toBe(404);
  });
});

describe("tokens", () => {
  it("lists YOUR tokens, marks the current one, and never sends a secret or hash", async () => {
    const r = await api("GET", "/tokens");
    expect(r.body.tokens.map(t => t.tokenId)).toEqual(["cur", "old"]);
    expect(r.body.tokens.find(t => t.tokenId === "cur").current).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/"hash"/);
  });
  it("revokes one, which then stops working", async () => {
    expect((await api("DELETE", "/tokens/old")).body.revoked).toBe(true);
    expect((await api("GET", "/grids", null, "moduli_old")).status).toBe(401);
  });
  it("cannot revoke another user's token", async () => {
    expect((await api("DELETE", "/tokens/theirs")).status).toBe(404);
    expect(TOKENS.find(t => t.tokenId === "theirs").revoked).toBe(false);
  });
});
