// Jellyfin connection settings: stored encrypted on the user, session-only routes, never returns the key.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import crypto from "crypto";

process.env.SECRETS_KEY = crypto.randomBytes(32).toString("base64");

const store = { meta: {} };
const setPath = (path, val) => {
  const parts = path.split("."); let o = store;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = val;
};
vi.mock("../models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: () => ({ catch: async () => JSON.parse(JSON.stringify(store)) }) }) }),
    updateOne: async (_q, upd) => {
      for (const [k, v] of Object.entries(upd.$set || {})) setPath(k, v);
      for (const k of Object.keys(upd.$unset || {})) setPath(k, undefined);
      return {};
    },
  },
}));
vi.mock("../models/ApiToken.js", () => ({
  default: { authenticate: async (raw) => (raw === "api-token" ? { userId: "u1", scopes: ["read", "write"], tokenId: "t" } : null) },
}));
vi.mock("../utils/jwts.js", async (orig) => ({
  ...(await orig()),
  verifyToken: (raw) => (raw === "session-jwt" ? { userId: "u1" } : null),
}));

const { makeApiV1Router } = await import("../routes/apiV1.js");
const { getJellyfinConfig, jellyfinFetch } = await import("../services/jellyfinConfig.js");

let server, base, fake, fakeUrl;
beforeAll(async () => {
  fake = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ServerName: "Home", auth: req.headers.authorization, tok: req.headers["x-emby-token"] }));
  }).listen(0);
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({ getUserCache: async () => ({}), peekUserCache: () => null, mirrorToCache: () => {}, io: null, userRoom: (u) => `user:${u}` }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => { server?.close(); fake?.close(); });
beforeEach(() => { store.meta = {}; });

const call = (method, path, body, bearer = "session-jwt") => fetch(`${base}${path}`, {
  method, headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
  body: body ? JSON.stringify(body) : undefined,
});

describe("jellyfin config routes", () => {
  it("GET after PUT returns no apiKey, and the stored key is ciphertext", async () => {
    const put = await call("PUT", "/jellyfin/config", { baseUrl: fakeUrl, apiKey: "SECRETKEY123", jfUserId: "abc", publicUrl: "https://m.example" });
    expect(put.status).toBe(200);
    const got = await (await call("GET", "/jellyfin/config")).json();
    expect(got).toMatchObject({ configured: true, baseUrl: fakeUrl, publicUrl: "https://m.example", jfUserId: "abc" });
    expect(JSON.stringify(got)).not.toContain("SECRETKEY123");
    expect(got).not.toHaveProperty("apiKey");
    const stored = store.meta.jellyfin.apiKey;
    expect(Object.keys(stored).sort()).toEqual(["authTag", "ciphertext", "iv"]);
    expect(JSON.stringify(store)).not.toContain("SECRETKEY123");
    expect((await getJellyfinConfig("u1")).apiKey).toBe("SECRETKEY123");
  });
  it("defaults the addresses", async () => {
    await call("PUT", "/jellyfin/config", { apiKey: "k", jfUserId: "abc" });
    const got = await (await call("GET", "/jellyfin/config")).json();
    expect(got.baseUrl).toBe("http://127.0.0.1:8097");
    expect(got.publicUrl).toBe("https://media.viafluere.com");
  });
  it("an API token (non-session) is refused on every route", async () => {
    for (const [m, p] of [["GET", "/jellyfin/config"], ["PUT", "/jellyfin/config"], ["DELETE", "/jellyfin/config"], ["GET", "/jellyfin/status"]]) {
      expect((await call(m, p, m === "PUT" ? { apiKey: "x" } : undefined, "api-token")).status).toBe(403);
    }
  });
  it("DELETE unconfigures; status reports the server name", async () => {
    await call("PUT", "/jellyfin/config", { baseUrl: fakeUrl, apiKey: "k", jfUserId: "abc" });
    const st = await (await call("GET", "/jellyfin/status")).json();
    expect(st).toMatchObject({ configured: true, online: true, serverName: "Home" });
    await call("DELETE", "/jellyfin/config");
    expect((await (await call("GET", "/jellyfin/config")).json()).configured).toBe(false);
    expect(await getJellyfinConfig("u1")).toBeNull();
  });
});

describe("jellyfinFetch", () => {
  it("sends the key in both headers", async () => {
    const r = await jellyfinFetch({ baseUrl: fakeUrl, apiKey: "K9" }, "/System/Info/Public");
    const j = await r.json();
    expect(j.auth).toBe('MediaBrowser Token="K9"');
    expect(j.tok).toBe("K9");
  });
  it("rejects with media_offline against a closed port, quickly", async () => {
    const t = Date.now();
    await expect(jellyfinFetch({ baseUrl: "http://127.0.0.1:1", apiKey: "k" }, "/x")).rejects.toMatchObject({ code: "media_offline" });
    expect(Date.now() - t).toBeLessThan(6000);
  });
});
