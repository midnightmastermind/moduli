// POST /share accepts the signed-in APP's session token as its Bearer — the
// phone/Windows share page runs inside the app and holds that, not an API
// token. EVERY OTHER /api/v1 route must still refuse it: the opt-in is per route.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../models/ApiToken.js", () => ({ default: { authenticate: async () => null } }));
vi.mock("../models/Grid.js", () => ({ default: {
  exists: async (q) => (q._id === "g1" && q.userId === "u1" ? { _id: "g1" } : null),
  find: () => ({ sort: () => ({ lean: async () => [] }) }),
  findOneAndUpdate: () => ({ lean: async () => ({ shareLog: [] }) }),
}}));
vi.mock("../models/User.js", () => ({ default: { findById: () => ({ lean: async () => ({ meta: {} }) }), updateOne: async () => ({}) } }));
vi.mock("../utils/shareRulesEnsure.js", () => ({ ensureCatchAllRule: async () => ({ created: false }) }));
vi.mock("../services/shareRules.js", () => ({ runShareRules: async () => ({ ran: [{ ok: true, created: [{ occurrenceId: "o", status: "created" }] }], halted: false }) }));

const { signToken } = await import("../utils/jwts.js");
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

const session = () => signToken({ userId: "u1" });
const post = (path, token, body) => fetch(base + path, { method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("the app's session token as a Bearer", () => {
  it("is accepted by POST /share", async () => {
    const r = await post("/share", session(), { gridId: "g1", text: "from the phone" });
    expect(r.status).toBe(201);
  });
  it("is REFUSED everywhere else", async () => {
    const r = await fetch(`${base}/grids`, { headers: { authorization: `Bearer ${session()}` } });
    expect(r.status).toBe(401);
    expect((await post("/occurrences", session(), { gridId: "g1", moduleId: "m" })).status).toBe(401);
  });
  it("a forged or expired session is refused by /share too", async () => {
    expect((await post("/share", "not-a-jwt", { gridId: "g1", text: "x" })).status).toBe(401);
  });
});
