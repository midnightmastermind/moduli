// GET /share/stage/:id/text — the post's own text for a shared Reddit link (user, 2026-10-12: "sharing reddit
// links doesnt allow the body to be transfered over"). Key-authorized like the stage read; when the text cannot
// be read it answers 200 with { text: null, reason } so the window falls back instead of showing an error.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

const STAGES = {
  "reddit-1": { url: "https://www.reddit.com/r/selfhosted/comments/abc123/x/", title: "X", shape: "link" },
  "other-1": { url: "https://example.com/a", title: "A", shape: "link" },
};
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000, createStage: async () => ({ stageId: "s", key: "k" }),
  readStage: async (id, key) => (key === "key-1" ? STAGES[id] || null : null), consumeStage: async () => null,
}));
let reply = null; const asked = [];
vi.mock("../utils/redditPost.js", () => ({ redditReader: () => ({ readPost: async (u) => { asked.push(u); return reply; } }) }));
vi.mock("../models/ApiToken.js", () => ({ default: { authenticate: async () => null } }));
const { makeApiV1Router } = await import("../routes/apiV1.js");

let server, base;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use("/api/v1", makeApiV1Router({ getUserCache: async () => ({}), peekUserCache: () => null, mirrorToCache: () => {}, io: null, userRoom: (u) => `user:${u}` }));
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server?.close());
beforeEach(() => { reply = null; asked.length = 0; });

describe("GET /share/stage/:id/text", () => {
  it("returns the post's text and title, reading the STAGED url", async () => {
    reply = { ok: true, title: "My setup", text: "Para one.\n\nPara two." };
    const r = await fetch(`${base}/share/stage/reddit-1/text?k=key-1`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ text: "Para one.\n\nPara two.", title: "My setup", source: "reddit" });
    expect(asked).toEqual(["https://www.reddit.com/r/selfhosted/comments/abc123/x/"]);
  });
  it("answers 200 with a reason when the text can't be read (no keys, not reddit)", async () => {
    reply = { ok: false, reason: "not_configured" };
    const r = await fetch(`${base}/share/stage/reddit-1/text?k=key-1`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: null, title: null, reason: "not_configured" });
  });
  it("a link post (no text of its own) gives text null, title kept", async () => {
    reply = { ok: true, title: "Look", text: "" };
    expect(await (await fetch(`${base}/share/stage/reddit-1/text?k=key-1`)).json()).toMatchObject({ text: null, title: "Look" });
  });
  it("is key-authorized: a wrong key is 404 and reads nothing", async () => {
    const r = await fetch(`${base}/share/stage/reddit-1/text?k=nope`);
    expect(r.status).toBe(404);
    expect(asked).toEqual([]);
  });
});
