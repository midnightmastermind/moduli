// POST /jellyfin/sync — the 15-minute skip is decided BEFORE the 202; force and dryRun bypass it; only a successful
// non-dry run stamps it (in memory and on grid.meta.jellyfinLastSyncAt).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import crypto from "crypto";

process.env.SECRETS_KEY = crypto.randomBytes(32).toString("base64");

const grid = { _id: "g1", userId: "u1", meta: {} };
const gridWrites = [];
vi.mock("../models/Grid.js", () => ({
  default: {
    findOne: () => ({ lean: async () => JSON.parse(JSON.stringify(grid)) }),
    updateOne: async (q, upd) => { gridWrites.push({ q, upd }); for (const [k, v] of Object.entries(upd.$set || {})) if (k === "meta.jellyfinLastSyncAt") grid.meta.jellyfinLastSyncAt = v; return {}; },
  },
}));
vi.mock("../models/User.js", () => ({
  default: { findById: () => ({ select: () => ({ lean: () => ({ catch: async () => ({}) }) }) }) },
}));
vi.mock("../services/jellyfinConfig.js", async (orig) => ({
  ...(await orig()),
  getJellyfinConfig: async () => ({ baseUrl: "http://x", apiKey: "K", userId: "jf1", publicUrl: "https://m" }),
}));
const runs = [];
let nextOutcome = "ok";
vi.mock("../services/jellyfinSync.js", async (orig) => ({
  ...(await orig()),
  syncJellyfin: async (args) => { runs.push(args); if (nextOutcome === "fail") throw new Error("boom"); return { items: 0, skipped: [], ambiguous: [] }; },
}));
vi.mock("../models/ApiToken.js", () => ({ default: { authenticate: async () => null } }));
vi.mock("../utils/jwts.js", async (orig) => ({ ...(await orig()), verifyToken: (raw) => (raw === "session-jwt" ? { userId: "u1" } : null) }));

const { makeApiV1Router } = await import("../routes/apiV1.js");
const { _resetSyncStamps } = await import("../services/jellyfinSync.js");

let server, base;
beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({ getUserCache: async () => ({}), peekUserCache: () => null, mirrorToCache: () => {}, io: { to: () => ({ emit: () => {} }) }, userRoom: (u) => `user:${u}` }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1/jellyfin/sync`;
});
afterAll(() => server?.close());
beforeEach(() => { runs.length = 0; gridWrites.length = 0; grid.meta = {}; nextOutcome = "ok"; _resetSyncStamps(); });

const sync = (body) => fetch(base, { method: "POST", headers: { authorization: "Bearer session-jwt", "content-type": "application/json" }, body: JSON.stringify(body) });
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("POST /jellyfin/sync — the 15-minute skip", () => {
  it("a second call within 15 minutes is skipped before the 202; force runs anyway", async () => {
    expect((await sync({ gridId: "g1" })).status).toBe(202);
    await settle();
    expect(runs.length).toBe(1);
    expect(gridWrites.some((w) => w.upd.$set?.["meta.jellyfinLastSyncAt"])).toBe(true);
    const again = await sync({ gridId: "g1" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ started: false, skipped: "recent" });
    await settle();
    expect(runs.length).toBe(1);
    expect((await sync({ gridId: "g1", force: true })).status).toBe(202);
    await settle();
    expect(runs.length).toBe(2);
  });
  it("a dry run neither skips nor stamps", async () => {
    await sync({ gridId: "g1" }); await settle();
    expect((await sync({ gridId: "g1", dryRun: true })).status).toBe(202);
    await settle();
    expect(runs.length).toBe(2);
    _resetSyncStamps(); grid.meta = {}; gridWrites.length = 0;
    await sync({ gridId: "g1", dryRun: true }); await settle();
    expect(gridWrites.length).toBe(0);
    expect((await sync({ gridId: "g1" })).status).toBe(202);
  });
  it("a failed run does not stamp, so the next call runs", async () => {
    nextOutcome = "fail";
    await sync({ gridId: "g1" }); await settle();
    expect(gridWrites.length).toBe(0);
    nextOutcome = "ok";
    expect((await sync({ gridId: "g1" })).status).toBe(202);
  });
  it("the persisted stamp survives a restart (in-memory cleared)", async () => {
    grid.meta = { jellyfinLastSyncAt: new Date(Date.now() - 60e3).toISOString() };
    const r = await sync({ gridId: "g1" });
    expect(r.status).toBe(200);
    expect((await r.json()).skipped).toBe("recent");
  });
});
