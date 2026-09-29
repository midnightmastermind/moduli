// server/__tests__/apiSharePresets.test.js
//
// Presets are written as meta.sharePresets ALONE. The window never holds the
// grid's whole meta, so a whole-meta write from it would drop every other key
// the app keeps there — the stale-snapshot clobber this repo has paid for.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../utils/jwts.js", () => ({ verifyToken: (t) => (t === "session-jwt" ? { userId: "u1" } : null) }));
vi.mock("../models/ApiToken.js", () => ({ default: { authenticate: async () => null } }));
const updates = [];
vi.mock("../models/Grid.js", () => ({ default: {
  findOne: (q) => ({ lean: () => Promise.resolve(q._id === "g1" && q.userId === "u1"
    ? { _id: "g1", meta: { sharePresets: [{ id: "p1", name: "Movie" }] } } : null) }),
  findOneAndUpdate: (q, u) => {
    updates.push(u);
    return Promise.resolve(q._id === "g1" && q.userId === "u1"
      ? { _id: { toString: () => "g1" }, meta: { defaultStyle: {}, sharePresets: u.$set["meta.sharePresets"] }, activeFilterValues: { f: "2026-09-29" } }
      : null);
  },
  exists: async () => null,
}}));

const emitted = [];
const { makeApiV1Router } = await import("../routes/apiV1.js");
let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({
    getUserCache: async () => ({}), peekUserCache: () => null, mirrorToCache: () => {},
    io: { to: () => ({ emit: (ev, p) => emitted.push({ ev, p }) }) }, userRoom: (u) => `user:${u}`,
  }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server?.close());

const H = { "content-type": "application/json", authorization: "Bearer session-jwt" };

describe("share presets", () => {
  it("reads a grid's presets with the SESSION token (the window has no API token)", async () => {
    const r = await fetch(`${base}/share/presets?gridId=g1`, { headers: H });
    expect(r.status).toBe(200);
    expect((await r.json()).presets).toEqual([{ id: "p1", name: "Movie" }]);
  });

  it("writes meta.sharePresets and NOTHING else on the grid", async () => {
    updates.length = 0;
    const r = await fetch(`${base}/share/presets`, { method: "PUT", headers: H,
      body: JSON.stringify({ gridId: "g1", presets: [{ id: "p2", name: "Recipe" }] }) });
    expect(r.status).toBe(200);
    expect(updates[0]).toEqual({ $set: { "meta.sharePresets": [{ id: "p2", name: "Recipe" }] } });
  });

  it("tells open tabs with id + meta only — no activeFilterValues to re-fire date ops", async () => {
    emitted.length = 0;
    await fetch(`${base}/share/presets`, { method: "PUT", headers: H, body: JSON.stringify({ gridId: "g1", presets: [] }) });
    expect(emitted[0].ev).toBe("grid_updated");
    expect(Object.keys(emitted[0].p.grid).sort()).toEqual(["id", "meta"]);
  });

  it("refuses another user's grid", async () => {
    expect((await fetch(`${base}/share/presets?gridId=g-other`, { headers: H })).status).toBe(404);
  });

  it("refuses a non-array", async () => {
    const r = await fetch(`${base}/share/presets`, { method: "PUT", headers: H, body: JSON.stringify({ gridId: "g1", presets: {} }) });
    expect(r.status).toBe(400);
  });

  it("refuses with no credentials at all", async () => {
    expect((await fetch(`${base}/share/presets?gridId=g1`)).status).toBe(401);
  });
});
