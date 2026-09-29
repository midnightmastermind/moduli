// server/__tests__/apiShareCover.test.js
//
// GET /share/stage/:id/cover — the picture the placement window offers for the
// clip in front of it (user, 2026-09-29: a shared IMDb link arrived as a movie
// with no picture and no way to add one).
//
// Two things here are load-bearing and neither is obvious from the route:
//   1. it is KEY-authorized, not token-authorized, exactly like the stage read.
//      The window may be open in a browser with no Moduli session.
//   2. it offers an og:image and NOTHING ELSE. `fetchLinkPreview` falls back to
//      a declared icon and then the site favicon, which is right for a bookmark
//      tile and wrong for a movie poster — a 16px favicon stretched into a
//      poster slot is worse than the title text it would replace. The
//      "falls back to a favicon" case below is what pins that.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

// The staged clips this suite reads. `shape` is what the extension parks
// alongside the url (`record.meta.clipShape`).
const STAGES = {
  "link-1": { url: "https://imdb.com/title/tt0450336", title: "A Guide to Recognizing Your Saints", shape: "link" },
  "img-1": { url: "https://img.example/poster.jpg", title: "poster", shape: "image" },
  "text-1": { text: "a selection with no url", shape: "text" },
  "bad-url": { url: "javascript:alert(1)", shape: "link" },
};
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000,
  createStage: async () => ({ stageId: "s", key: "k" }),
  readStage: async (id, key) => (key === "key-1" ? STAGES[id] || null : null),
  consumeStage: async () => null,
}));

// What the page says about itself. Each test sets this.
let preview = null;
const previewCalls = [];
vi.mock("../utils/linkPreview.js", () => ({
  fetchLinkPreview: async (url) => { previewCalls.push(url); return preview; },
}));
vi.mock("../utils/safeFetchUrl.js", () => ({ fetchPageHtml: async () => ({ html: "", url: "x" }) }));

vi.mock("../models/ApiToken.js", () => ({ default: { authenticate: async () => null } }));

const { makeApiV1Router } = await import("../routes/apiV1.js");

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", makeApiV1Router({
    getUserCache: async () => ({}), peekUserCache: () => null,
    mirrorToCache: () => {}, io: null, userRoom: (u) => `user:${u}`,
  }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server?.close());
beforeEach(() => { preview = null; previewCalls.length = 0; });

const cover = (id, k = "key-1") => fetch(`${base}/share/stage/${id}/cover?k=${encodeURIComponent(k)}`);

describe("GET /share/stage/:id/cover", () => {
  it("gives the page's og:image, with NO token", async () => {
    preview = { ok: true, cover: "https://img/og.jpg", coverVia: "og" };
    const r = await cover("link-1");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cover: "https://img/og.jpg", via: "og" });
    expect(previewCalls).toEqual(["https://imdb.com/title/tt0450336"]);
  });

  it("offers NOTHING when the page has no og:image — a favicon is not a poster", async () => {
    // fetchLinkPreview always returns *something* (it falls back to
    // /favicon.ico), so "the preview has a cover" is not the question.
    preview = { ok: true, cover: "https://imdb.com/favicon.ico", coverVia: "favicon" };
    expect(await (await cover("link-1")).json()).toEqual({ cover: null, via: null });
  });

  it("an image clip IS its own picture — no fetch at all", async () => {
    expect(await (await cover("img-1")).json()).toEqual({ cover: "https://img.example/poster.jpg", via: "image" });
    expect(previewCalls).toEqual([]);
  });

  it("a text clip has nothing to fetch", async () => {
    expect(await (await cover("text-1")).json()).toEqual({ cover: null, via: null });
    expect(previewCalls).toEqual([]);
  });

  it("never fetches a non-http url", async () => {
    // The staged url reaches a fetcher, so the scheme is checked before it does.
    expect(await (await cover("bad-url")).json()).toEqual({ cover: null, via: null });
    expect(previewCalls).toEqual([]);
  });

  it("reports an unreachable page as no cover rather than failing the window", async () => {
    preview = { ok: false, error: "could not reach that link" };
    const r = await cover("link-1");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cover: null, via: null });
  });

  it("refuses the wrong key, and an unknown stage", async () => {
    expect((await cover("link-1", "wrong")).status).toBe(404);
    expect((await cover("no-such-stage")).status).toBe(404);
  });
});
