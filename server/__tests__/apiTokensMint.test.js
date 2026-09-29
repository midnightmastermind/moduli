// server/__tests__/apiTokensMint.test.js
//
// POST /tokens — minting an API token from the app.
//
// THE RULE THIS PINS is the one 2026-09-24 wrote down when it deliberately
// left minting out of the API: *"a token that can mint tokens makes a leak
// permanent."* That reasoning is untouched — what it forbids is minting WITH
// A TOKEN. Minting from a signed-in session grants nothing the session did not
// already have. So the discriminating test is not "does it mint" but "does it
// refuse a perfectly valid, write-scoped API token".
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

const minted = [];
vi.mock("../models/ApiToken.js", () => ({
  default: {
    authenticate: async (raw) => (raw === "api-token"
      ? { userId: "u1", scopes: ["read", "write"], tokenId: "t-api" }
      : null),
    mint: async ({ userId, name, scopes }) => {
      const tokenDoc = { tokenId: "t-new", userId, name, scopes, createdAt: new Date("2026-09-29") };
      minted.push(tokenDoc);
      return { rawToken: "moduli_t-new_secret", tokenDoc };
    },
    find: () => ({ sort: () => ({ lean: async () => minted.map((t) => ({ ...t, revoked: false })) }) }),
    updateOne: async () => ({ matchedCount: 1 }),
  },
}));

// The session JWT this suite signs in with.
vi.mock("../utils/jwts.js", async (orig) => ({
  ...(await orig()),
  verifyToken: (raw) => (raw === "session-jwt" ? { userId: "u1" } : null),
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
beforeEach(() => { minted.length = 0; });

const post = (body, bearer) => fetch(`${base}/tokens`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : null) },
  body: JSON.stringify(body),
});

describe("POST /tokens", () => {
  it("mints from a signed-in session and returns the secret ONCE", async () => {
    const r = await post({ name: "Chrome extension", scopes: ["read", "write"] }, "session-jwt");
    expect(r.status).toBe(201);
    const b = await r.json();
    expect(b.token).toBe("moduli_t-new_secret");
    expect(b).toMatchObject({ tokenId: "t-new", name: "Chrome extension", scopes: ["read", "write"] });
    expect(minted[0].userId).toBe("u1");
  });

  it("the secret is NOT in the listing — only its hash is stored", async () => {
    await post({ name: "x" }, "session-jwt");
    const b = await (await fetch(`${base}/tokens`, { headers: { authorization: "Bearer session-jwt" } })).json();
    expect(b.tokens).toHaveLength(1);
    expect(JSON.stringify(b.tokens)).not.toContain("secret");
    expect(b.tokens[0]).not.toHaveProperty("hash");
  });

  // THE LOAD-BEARING ONE. This token has the write scope and authenticates
  // fine; it is refused because it is a TOKEN, so a leaked one cannot issue
  // itself a successor and revoking it actually ends its access.
  it("REFUSES a valid write-scoped API token", async () => {
    const r = await post({ name: "successor" }, "api-token");
    expect(r.status).toBe(403);
    expect((await r.json()).message).toMatch(/signed in/i);
    expect(minted).toHaveLength(0);
  });

  it("refuses with no bearer at all", async () => {
    expect((await post({ name: "x" })).status).toBe(401);
    expect(minted).toHaveLength(0);
  });

  it("names an unnamed token by date rather than leaving it blank", async () => {
    const b = await (await post({}, "session-jwt")).json();
    expect(b.name).toMatch(/^token \d{4}-\d{2}-\d{2}$/);
  });

  it("keeps only the scopes it knows, and refuses a request that leaves none", async () => {
    const ok = await (await post({ scopes: ["read", "admin"] }, "session-jwt")).json();
    expect(ok.scopes).toEqual(["read"]);
    const bad = await post({ scopes: ["admin"] }, "session-jwt");
    expect(bad.status).toBe(400);
  });

  it("revoking takes the session too, so the UI can do it", async () => {
    const r = await fetch(`${base}/tokens/t-new`, {
      method: "DELETE", headers: { authorization: "Bearer session-jwt" },
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, revoked: true });
  });
});
