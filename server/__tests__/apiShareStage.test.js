// server/__tests__/apiShareStage.test.js
//
// Staging over the real router. The point of these two routes is that the
// FIRST needs a token and the SECOND deliberately does not — the window may be
// open in a browser with no Moduli session, and the key is what stands in.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../models/ApiToken.js", () => ({ default: {
  authenticate: async (raw) => (raw === "good-token" ? { userId: "u1", scopes: ["read", "write"], tokenId: "t" } : null),
}}));
const staged = [];
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000,
  createStage: async ({ userId, payload }) => {
    staged.push({ userId, payload });
    return { stageId: "stage-1", key: "key-1" };
  },
  readStage: async (id, key) => (id === "stage-1" && key === "key-1" ? { url: "https://x", title: "T" } : null),
  consumeStage: async () => null,
}));

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

const post = (path, body, token) => fetch(`${base}${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

describe("POST /share/stage", () => {
  it("stages a clip and hands back an id and a key", async () => {
    const r = await post("/share/stage", { url: "https://x", title: "T" }, "good-token");
    expect(r.status).toBe(201);
    const b = await r.json();
    expect(b).toMatchObject({ stageId: "stage-1", key: "key-1" });
    expect(b.expiresInMs).toBe(600000);
    expect(staged.at(-1).userId).toBe("u1");
  });

  it("refuses without a token — staging is an authenticated act", async () => {
    expect((await post("/share/stage", { url: "https://x" })).status).toBe(401);
  });

  it("refuses an empty share", async () => {
    // Same rule /share has: something must be being shared.
    expect((await post("/share/stage", {}, "good-token")).status).toBe(400);
  });
});

describe("GET /share/stage/:id", () => {
  it("returns the payload for the right key, with NO token", async () => {
    const r = await fetch(`${base}/share/stage/stage-1?k=key-1`);
    expect(r.status).toBe(200);
    expect((await r.json()).payload).toMatchObject({ url: "https://x" });
  });

  it("404s on a wrong key", async () => {
    expect((await fetch(`${base}/share/stage/stage-1?k=nope`)).status).toBe(404);
  });

  it("404s with no key at all", async () => {
    expect((await fetch(`${base}/share/stage/stage-1`)).status).toBe(404);
  });
});
