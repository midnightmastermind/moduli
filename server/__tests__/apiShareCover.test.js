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
// The REAL `fetchLinkPreview` fetches the page through the `fetchPageHtml` it
// is handed — which is exactly what the route reuses to read the candidates.
// A mock that ignored that argument would make the one-fetch test vacuous.
vi.mock("../utils/linkPreview.js", () => ({
  fetchLinkPreview: async (url, { fetchPageHtml } = {}) => {
    previewCalls.push(url);
    if (fetchPageHtml) await fetchPageHtml(url);
    return preview;
  },
}));
// What the page's bytes look like. The route reads them a SECOND time for the
// candidate list, through the same single fetch.
let pageHtml = "";
vi.mock("../utils/safeFetchUrl.js", () => ({
  fetchPageHtml: async (u) => { fetchCalls.push(u); return { html: pageHtml, url: u }; },
}));
const fetchCalls = [];

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
beforeEach(() => { preview = null; previewCalls.length = 0; fetchCalls.length = 0; pageHtml = ""; });

const cover = (id, k = "key-1") => fetch(`${base}/share/stage/${id}/cover?k=${encodeURIComponent(k)}`);

describe("GET /share/stage/:id/cover", () => {
  it("gives the page's og:image, with NO token", async () => {
    preview = { ok: true, cover: "https://img/og.jpg", coverVia: "og" };
    const r = await cover("link-1");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ cover: "https://img/og.jpg", via: "og" });
    expect(previewCalls).toEqual(["https://imdb.com/title/tt0450336"]);
  });

  it("offers NOTHING when the page has no og:image — a favicon is not a poster", async () => {
    // fetchLinkPreview always returns *something* (it falls back to
    // /favicon.ico), so "the preview has a cover" is not the question.
    preview = { ok: true, cover: "https://imdb.com/favicon.ico", coverVia: "favicon" };
    expect(await (await cover("link-1")).json()).toMatchObject({ cover: null, via: null });
  });

  it("an image clip IS its own picture — no fetch at all", async () => {
    expect(await (await cover("img-1")).json()).toMatchObject({ cover: "https://img.example/poster.jpg", via: "image" });
    expect(previewCalls).toEqual([]);
  });

  it("a text clip has nothing to fetch", async () => {
    expect(await (await cover("text-1")).json()).toMatchObject({ cover: null, via: null });
    expect(previewCalls).toEqual([]);
  });

  it("never fetches a non-http url", async () => {
    // The staged url reaches a fetcher, so the scheme is checked before it does.
    expect(await (await cover("bad-url")).json()).toMatchObject({ cover: null, via: null });
    expect(previewCalls).toEqual([]);
  });

  it("reports an unreachable page as no cover rather than failing the window", async () => {
    preview = { ok: false, error: "could not reach that link" };
    const r = await cover("link-1");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ cover: null, via: null });
  });

  it("refuses the wrong key, and an unknown stage", async () => {
    expect((await cover("link-1", "wrong")).status).toBe(404);
    expect((await cover("no-such-stage")).status).toBe(404);
  });
});

// ── the page's OWN photos, offered beside the suggestion ──────────────────
// User, 2026-09-29: "give it that image search thing we have as well to choose
// from (or photos we get from the share)".
describe("GET /share/stage/:id/cover — candidates", () => {
  it("returns every picture the page offers, og:image first", async () => {
    preview = { ok: true, cover: "https://img/og.jpg", coverVia: "og" };
    pageHtml = `
      <meta property="og:image" content="https://img/og.jpg">
      <img src="https://img/poster.jpg" alt="poster">
      <img src="https://img/still.jpg">
    `;
    const b = await (await cover("link-1")).json();
    expect(b.cover).toBe("https://img/og.jpg");
    expect(b.candidates.map((c) => c.url)).toEqual([
      "https://img/og.jpg", "https://img/poster.jpg", "https://img/still.jpg",
    ]);
  });

  // ONE outbound request. The window waits on this, and asking the page twice
  // for the same bytes doubles that wait.
  it("fetches the page exactly ONCE for both answers", async () => {
    preview = { ok: true, cover: "https://img/og.jpg", coverVia: "og" };
    pageHtml = `<meta property="og:image" content="https://img/og.jpg"><img src="https://img/a.jpg">`;
    await cover("link-1");
    expect(fetchCalls).toHaveLength(1);
  });

  // The suggestion and the alternatives are separate answers: a page whose
  // og:image is only a site banner still offers the article's own pictures.
  it("offers candidates even when no og:image qualifies as the suggestion", async () => {
    preview = { ok: true, cover: "https://img/icon.ico", coverVia: "favicon" };
    pageHtml = `<img src="https://img/poster.jpg">`;
    const b = await (await cover("link-1")).json();
    expect(b.cover).toBeNull();
    expect(b.candidates.map((c) => c.url)).toEqual(["https://img/poster.jpg"]);
  });

  it("an image clip is its own only candidate, with no fetch", async () => {
    const b = await (await cover("img-1")).json();
    expect(b.candidates).toEqual([{ url: "https://img.example/poster.jpg", via: "image" }]);
    expect(fetchCalls).toEqual([]);
  });

  it("an unreachable page answers with an empty list, not an error", async () => {
    preview = { ok: false, error: "could not reach that link" };
    const r = await cover("link-1");
    expect(r.status).toBe(200);
    expect((await r.json()).candidates).toEqual([]);
  });
});
