// Jellyfin play / progress / played endpoints: owner's row only, owner's Jellyfin user only, offline never 500.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import crypto from "crypto";

process.env.SECRETS_KEY = crypto.randomBytes(32).toString("base64");

const store = { meta: {} };
const rows = {};
vi.mock("../models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: () => ({ catch: async () => JSON.parse(JSON.stringify(store)) }) }) }),
    updateOne: async (_q, upd) => { for (const [, v] of Object.entries(upd.$set || {})) store.meta.jellyfin = v; return {}; },
  },
}));
vi.mock("../models/Occurrence.js", () => ({
  default: { findOne: (q) => ({ lean: async () => { const r = rows[q.id]; return r && r.userId === q.userId ? r : null; } }) },
}));
vi.mock("../models/ApiToken.js", () => ({
  default: { authenticate: async (raw) => (raw === "api-token" ? { userId: "u1", scopes: ["read", "write"], tokenId: "t" } : null) },
}));
vi.mock("../utils/jwts.js", async (orig) => ({ ...(await orig()), verifyToken: (raw) => (raw === "session-jwt" ? { userId: "u1" } : null) }));

const { makeApiV1Router } = await import("../routes/apiV1.js");
const { setJellyfinConfig } = await import("../services/jellyfinConfig.js");

let server, base, fake, fakeUrl, calls, item;
beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null, token: req.headers["x-emby-token"] });
      if (req.url.startsWith("/Users/jf1/Items/")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(item)); }
      res.statusCode = 204; res.end();
    });
  }).listen(0);
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({ getUserCache: async () => ({}), peekUserCache: () => null, mirrorToCache: () => {}, io: null, userRoom: (u) => `user:${u}` }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1/jellyfin`;
});
afterAll(() => { server?.close(); fake?.close(); });
beforeEach(async () => {
  store.meta = {}; calls = [];
  item = { RunTimeTicks: 72000000000, UserData: { PlaybackPositionTicks: 1234500000 } };
  rows.o1 = { id: "o1", userId: "u1", meta: { jellyfinId: "JF9", jellyfinPlayable: true } };
  rows.bare = { id: "bare", userId: "u1", meta: {} };
  rows.theirs = { id: "theirs", userId: "u2", meta: { jellyfinId: "X" } };
  await setJellyfinConfig("u1", { baseUrl: fakeUrl, apiKey: "KEY", jfUserId: "jf1", publicUrl: "https://media.example" });
});
const H = { authorization: "Bearer session-jwt", "content-type": "application/json" };
const play = (id, h = H) => fetch(`${base}/play/${id}`, { headers: h });
const post = (path, body, h = H) => fetch(`${base}${path}`, { method: "POST", headers: h, body: JSON.stringify(body) });

describe("GET /jellyfin/play/:occId", () => {
  it("401 without a session, 403 for an API token", async () => {
    expect((await play("o1", {})).status).toBe(401);
    expect((await play("o1", { authorization: "Bearer api-token" })).status).toBe(403);
  });
  it("unlinked row -> playable false; another user's row too", async () => {
    expect(await (await play("bare")).json()).toMatchObject({ playable: false });
    expect(await (await play("theirs")).json()).toMatchObject({ playable: false });
    expect(await (await play("missing")).json()).toMatchObject({ playable: false });
  });
  it("not configured -> playable false, configured false", async () => {
    store.meta = {};
    const j = await (await play("o1")).json();
    expect(j).toMatchObject({ playable: false, configured: false });
  });
  it("returns urls, ticks converted to seconds, a playSessionId", async () => {
    const j = await (await play("o1")).json();
    expect(j.playable).toBe(true);
    expect(j.resumeSeconds).toBeCloseTo(123.45);
    expect(j.runtimeSeconds).toBe(7200);
    expect(j.hlsUrl).toBe("/api/v1/jellyfin/media/Videos/JF9/master.m3u8?MediaSourceId=JF9&VideoCodec=h264&AudioCodec=aac&MaxStreamingBitrate=4000000");
    expect(j.directUrl).toBe("/api/v1/jellyfin/media/Videos/JF9/stream?static=true&MediaSourceId=JF9");
    expect(j.openUrl).toBe("https://media.example/web/#/details?id=JF9");
    expect(typeof j.playSessionId).toBe("string");
    expect(JSON.stringify(j)).not.toContain("KEY");
    expect(calls[0].url).toContain("/Users/jf1/Items/JF9");
  });
  it("upstream down -> 200 offline with openUrl", async () => {
    await setJellyfinConfig("u1", { baseUrl: "http://127.0.0.1:1", apiKey: "KEY", jfUserId: "jf1", publicUrl: "https://media.example" });
    const r = await play("o1");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ offline: true, playable: true, openUrl: "https://media.example/web/#/details?id=JF9" });
  });
});

describe("POST /jellyfin/progress", () => {
  it("starts the session once, then reports progress with ticks", async () => {
    const { playSessionId } = await (await play("o1")).json();
    calls = [];
    await post("/progress", { occId: "o1", seconds: 10.5, paused: false, playSessionId });
    await post("/progress", { occId: "o1", seconds: 15, paused: true, playSessionId });
    expect(calls.map((c) => c.url)).toEqual(["/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Progress"]);
    expect(calls[0].body).toMatchObject({ ItemId: "JF9", PlaySessionId: playSessionId, PositionTicks: 105000000 });
    expect(calls[2].body).toMatchObject({ PositionTicks: 150000000, IsPaused: true });
    expect(calls.every((c) => c.token === "KEY")).toBe(true);
  });
  it("ignores a client-supplied Jellyfin user id and refuses others' rows", async () => {
    expect((await post("/progress", { occId: "theirs", seconds: 1, playSessionId: "s" })).status).toBe(404);
    expect(calls.length).toBe(0);
  });
  it("upstream down -> 200 offline", async () => {
    await setJellyfinConfig("u1", { baseUrl: "http://127.0.0.1:1", apiKey: "KEY", jfUserId: "jf1" });
    const r = await post("/progress", { occId: "o1", seconds: 1, playSessionId: "s" });
    expect(r.status).toBe(200);
    expect((await r.json()).offline).toBe(true);
  });
});

describe("POST /jellyfin/played", () => {
  it("posts PlayedItems for the stored user only, and stops a known session", async () => {
    const { playSessionId } = await (await play("o1")).json();
    await post("/progress", { occId: "o1", seconds: 5, playSessionId });
    calls = [];
    const r = await post("/played", { occId: "o1", playSessionId, jfUserId: "evil", userId: "evil" });
    expect(r.status).toBe(200);
    const urls = calls.map((c) => `${c.method} ${c.url}`);
    expect(urls).toContain("POST /Users/jf1/PlayedItems/JF9");
    expect(urls).toContain("POST /Sessions/Playing/Stopped");
    expect(JSON.stringify(calls)).not.toContain("evil");
  });
  it("refuses an unlinked or foreign row", async () => {
    expect((await post("/played", { occId: "bare" })).status).toBe(404);
    expect((await post("/played", { occId: "theirs" })).status).toBe(404);
    expect(calls.length).toBe(0);
  });
});
