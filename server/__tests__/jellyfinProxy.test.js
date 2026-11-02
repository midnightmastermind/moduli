// Jellyfin streaming proxy: session auth (header or ?t=), path allow-list, key injection, ranges, offline, HLS rewrite.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import crypto from "crypto";

process.env.SECRETS_KEY = crypto.randomBytes(32).toString("base64");

const store = { meta: {} };
vi.mock("../models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: () => ({ catch: async () => JSON.parse(JSON.stringify(store)) }) }) }),
    updateOne: async (_q, upd) => { for (const [k, v] of Object.entries(upd.$set || {})) { store.meta.jellyfin = v; } return {}; },
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
const { setJellyfinConfig } = await import("../services/jellyfinConfig.js");
const { rewritePlaylist } = await import("../services/jellyfinProxy.js");

let server, base, fake, fakeUrl, seen, hang, seenAll, other, otherUrl, otherHits;
beforeAll(async () => {
  other = http.createServer((req, res) => { otherHits++; res.end("other"); }).listen(0);
  otherUrl = `http://127.0.0.1:${other.address().port}`;
  fake = http.createServer((req, res) => {
    seen = { url: req.url, headers: req.headers, method: req.method };
    seenAll.push(req.url);
    if (req.url.startsWith("/Videos/redir")) { res.writeHead(302, { location: `${otherUrl}/steal` }); return res.end(); }
    if (req.url.includes("leak.m3u8")) {
      res.setHeader("content-type", "application/vnd.apple.mpegurl");
      return res.end("#EXTM3U\nmain.m3u8?api_key=SERVERKEY\n");
    }
    if (req.url.includes("bad.m3u8")) {
      res.setHeader("content-type", "application/vnd.apple.mpegurl");
      return res.end("#EXTM3U\n#EXT-X-FOO:x=SERVERKEY\nseg.ts\n");
    }
    if (req.url.includes("abs.m3u8")) {
      res.setHeader("content-type", "application/vnd.apple.mpegurl");
      return res.end(`#EXTM3U\n${fakeUrl}/Videos/9/seg.ts?ApiKey=SERVERKEY&x=1\n/Videos/9/seg2.ts\n#EXT-X-MAP:URI="/Videos/9/init.mp4"\n`);
    }
    if (req.url.startsWith("/Videos/hang")) { hang = res; res.writeHead(200, { "content-type": "video/mp4" }); res.write("x"); return; }
    if (req.url.startsWith("/Videos/slowheaders")) return; // never answers
    if (req.url.includes("master.m3u8")) {
      res.setHeader("content-type", "application/vnd.apple.mpegurl");
      return res.end("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:3,\nseg0.ts?x=1\nseg1.ts\n");
    }
    if (req.headers.range) {
      res.writeHead(206, { "content-type": "video/mp4", "content-range": "bytes 0-99/1000", "content-length": "100", "accept-ranges": "bytes" });
      return res.end(Buffer.alloc(100, 1));
    }
    res.setHeader("content-type", "video/mp4");
    res.end("hello");
  }).listen(0);
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({ getUserCache: async () => ({}), peekUserCache: () => null, mirrorToCache: () => {}, io: null, userRoom: (u) => `user:${u}` }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1/jellyfin/media`;
});
afterAll(() => { server?.close(); fake?.close(); other?.close(); });
beforeEach(async () => { store.meta = {}; seen = null; seenAll = []; otherHits = 0; await setJellyfinConfig("u1", { baseUrl: fakeUrl, apiKey: "SERVERKEY", jfUserId: "j" }); });

const get = (path, headers = { authorization: "Bearer session-jwt" }, init = {}) => fetch(`${base}${path}`, { headers, ...init });

describe("jellyfin media proxy", () => {
  it("401 without a session", async () => {
    expect((await get("/Videos/1/stream", {})).status).toBe(401);
  });
  it("accepts ?t=<session jwt> and refuses an API token", async () => {
    expect((await get("/Videos/1/stream?t=session-jwt", {})).status).toBe(200);
    expect((await get("/Videos/1/stream", { authorization: "Bearer api-token" })).status).toBe(403);
  });
  it("passes Range through: 206 with Content-Range", async () => {
    const r = await get("/Videos/1/stream", { authorization: "Bearer session-jwt", range: "bytes=0-99" });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect(seen.headers.range).toBe("bytes=0-99");
    expect((await r.arrayBuffer()).byteLength).toBe(100);
  });
  it("strips client key material and adds the server key", async () => {
    await (await get("/Videos/1/stream?api_key=EVIL&ApiKey=EVIL2&t=session-jwt&Static=true", {
      "x-emby-token": "EVIL", authorization: "Bearer session-jwt",
    })).arrayBuffer();
    expect(seen.url).toBe("/Videos/1/stream?Static=true");
    expect(seen.headers["x-emby-token"]).toBe("SERVERKEY");
    expect(seen.headers.authorization).toBe('MediaBrowser Token="SERVERKEY"');
  });
  it("only /Videos/ /Items/ /Audio/ are reachable", async () => {
    expect((await get("/System/Info")).status).toBe(404);
    expect((await get("/Users/abc")).status).toBe(404);
    expect((await get("/Items/1/Images/Primary")).status).toBe(200);
    expect((await get("/Audio/1/stream")).status).toBe(200);
    // listings and metadata (the admin key would show other users' items) are not reachable
    expect((await get("/Items?userId=x")).status).toBe(404);
    expect((await get("/Items/1")).status).toBe(404);
    expect((await get("/Videos/1")).status).toBe(404);
    expect((await get("/Items/1/PlaybackInfo")).status).toBe(404);
    expect(seen.url).toBe("/Audio/1/stream");
  });
  it("an encoded ? or # in a segment never becomes an upstream query, and mixed dot forms are 404", async () => {
    for (const p of ["/Videos/x%3Fapi_key=EVIL/stream", "/Videos/x/stream%3Fapi_key=EVIL", "/Videos/x/s%23frag", "/Videos/.%252E/System/Configuration", "/Videos/%252e%252e/System/Configuration"]) {
      expect((await get(p)).status, p).toBe(404);
    }
    expect(seenAll).toEqual([]);
    expect((await get("/Videos/abc/stream.mp4?Static=true")).status).toBe(200);
    expect(seen.url).toBe("/Videos/abc/stream.mp4?Static=true");
  });
  it("DELETE is allowed for /Videos/ActiveEncodings exactly, not for longer paths", async () => {
    expect((await fetch(`${base}/Videos/ActiveEncodings/x`, { method: "DELETE", headers: { authorization: "Bearer session-jwt" } })).status).toBe(404);
  });
  it("POST is 404; DELETE only under /Videos/ActiveEncodings", async () => {
    expect((await get("/Videos/1/stream", undefined, { method: "POST", headers: { authorization: "Bearer session-jwt" } })).status).toBe(404);
    expect((await fetch(`${base}/Videos/1/stream`, { method: "DELETE", headers: { authorization: "Bearer session-jwt" } })).status).toBe(404);
    expect((await fetch(`${base}/Videos/ActiveEncodings?deviceId=d`, { method: "DELETE", headers: { authorization: "Bearer session-jwt" } })).status).toBe(200);
    expect(seen.method).toBe("DELETE");
  });
  it("upstream down -> 503 media_offline", async () => {
    await setJellyfinConfig("u1", { baseUrl: "http://127.0.0.1:1", apiKey: "k", jfUserId: "j" });
    const r = await get("/Videos/1/stream");
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("media_offline");
  });
  it("times out waiting for headers (5s) but not while a body streams", async () => {
    const t = Date.now();
    const r = await get("/Videos/slowheaders/stream");
    expect(r.status).toBe(503);
    expect(Date.now() - t).toBeLessThan(7000);
    const s = await get("/Videos/hang/stream");
    expect(s.status).toBe(200);
    await new Promise((r2) => setTimeout(r2, 5600));
    hang.end("tail");
    expect(await s.text()).toBe("xtail"); // body outlived the 5s timeout
  }, 20000);
  it("aborts upstream when the browser disconnects", async () => {
    const ctl = new AbortController();
    const closed = new Promise((res) => { /* set when fake sees close */ fake.once("request", (_rq, rs) => rs.on("close", res)); });
    const p = get("/Videos/hang/stream", { authorization: "Bearer session-jwt" }, { signal: ctl.signal }).catch(() => null);
    const r = await p;
    ctl.abort();
    await r?.body?.cancel().catch(() => {});
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error("upstream not aborted")), 3000))]);
  });
  it("rewrites HLS playlists so segments keep ?t=", async () => {
    const txt = await (await get("/Videos/1/master.m3u8?t=session-jwt", {})).text();
    expect(txt).toContain("seg0.ts?x=1&t=session-jwt");
    expect(txt).toContain("seg1.ts?t=session-jwt");
    expect(txt).toContain('URI="init.mp4?t=session-jwt"');
  });
});

describe("review round 1", () => {
  it("path traversal via encoded / backslash / dot variants is 404 and never reaches upstream", async () => {
    for (const p of ["/Videos/%252e%252e/System/Info", "/Videos/..%5CSystem%5CInfo", "/Videos/.%2E/System/Info", "/Videos/%2e%2e/System/Info", "/Videos/a%5Cb"]) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
    }
    expect(seenAll).toEqual([]);
  });
  it("playlist: api_key params are stripped from URIs", async () => {
    const txt = await (await get("/Videos/1/leak.m3u8?t=session-jwt", {})).text();
    expect(txt).not.toContain("SERVERKEY");
    expect(txt).toContain("main.m3u8?t=session-jwt");
  });
  it("playlist: absolute baseUrl and root-relative URIs become proxy-relative", async () => {
    const txt = await (await get("/Videos/1/abs.m3u8?t=session-jwt", {})).text();
    expect(txt).not.toContain("SERVERKEY");
    expect(txt).not.toContain(fakeUrl);
    expect(txt).toContain("/api/v1/jellyfin/media/Videos/9/seg.ts?x=1&t=session-jwt");
    expect(txt).toContain("/api/v1/jellyfin/media/Videos/9/seg2.ts?t=session-jwt");
    expect(txt).toContain('URI="/api/v1/jellyfin/media/Videos/9/init.mp4?t=session-jwt"');
  });
  it("playlist still containing the key -> 502", async () => {
    const r = await get("/Videos/1/bad.m3u8?t=session-jwt", {});
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("SERVERKEY");
  });
  it("upstream redirect is passed back, never followed", async () => {
    const r = await get("/Videos/redir/stream", { authorization: "Bearer session-jwt" }, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(otherHits).toBe(0);
  });
});

describe("rewritePlaylist", () => {
  it("leaves comments and absolute URLs alone, appends to relative ones", () => {
    const out = rewritePlaylist("#EXTM3U\n#EXTINF:3,\na.ts\nhttps://x/y.ts\n", "tok");
    expect(out).toBe("#EXTM3U\n#EXTINF:3,\na.ts?t=tok\nhttps://x/y.ts\n");
  });
});
