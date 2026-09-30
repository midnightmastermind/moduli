// server/__tests__/bootstrapTokenBounded.test.js
//
// GET /assistant/bootstrap-token mints an `assistant (auto)` token when the
// env token is stale — and the drawer asks on EVERY mount that finds no saved
// token, so it minted a fresh write-scoped credential each time.
//
// FOUND BY THE UI, 2026-09-29: the new tokens screen in Connections rendered
// 2,795 rows. Measured on prod: **3,110 live `assistant (auto)` tokens, 4 ever
// used, none in the last week**, between 2026-08-21 and 2026-09-24. Each one
// acts as the user in full.
//
// Reuse is impossible — only the hash is stored — so the fix is to RETIRE the
// others, which makes the endpoint idempotent in effect.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

let rows = [];
let nextId = 0;
const updateManyCalls = [];

vi.mock("../models/ApiToken.js", () => ({
  default: {
    // The env token is what decides whether the mint branch runs at all.
    authenticate: async (raw) => rows.find((r) => !r.revoked && raw === `moduli_${r.tokenId}_s`) || null,
    mint: async ({ userId, name, scopes }) => {
      const tokenDoc = { tokenId: `auto-${++nextId}`, userId, name, scopes, revoked: false };
      rows.push(tokenDoc);
      return { rawToken: `moduli_${tokenDoc.tokenId}_s`, tokenDoc };
    },
    updateMany: async (filter, update) => {
      updateManyCalls.push({ filter, update });
      let n = 0;
      for (const r of rows) {
        if (r.userId !== filter.userId) continue;
        if (r.name !== filter.name) continue;
        if (filter.revoked === false && r.revoked) continue;
        if (filter.tokenId?.$ne && r.tokenId === filter.tokenId.$ne) continue;
        Object.assign(r, update.$set); n++;
      }
      return { modifiedCount: n };
    },
    find: () => ({ sort: () => ({ lean: async () => rows }) }),
  },
}));

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
beforeEach(() => {
  rows = []; nextId = 0; updateManyCalls.length = 0;
  process.env.ASSISTANT_API_TOKEN = "moduli_stale_s";   // no row → 401 → mint branch
  delete process.env.ASSISTANT_BOOTSTRAP;
});

const ask = () => fetch(`${base}/assistant/bootstrap-token`, { headers: { authorization: "Bearer session-jwt" } });
const live = (name = "assistant (auto)") => rows.filter((r) => r.name === name && !r.revoked);

describe("bootstrap-token stays bounded", () => {
  it("still hands back a working token — the drawer must always connect", async () => {
    const b = await (await ask()).json();
    expect(b.token).toBe("moduli_auto-1_s");
    expect(live()).toHaveLength(1);
  });

  // THE DEFECT, stated as a number. Ten mounts used to leave ten live
  // credentials; now the newest is the only one that is still a credential.
  it("ten asks leave exactly ONE live auto token", async () => {
    let last;
    for (let i = 0; i < 10; i++) last = (await (await ask()).json()).token;
    expect(rows.filter((r) => r.name === "assistant (auto)")).toHaveLength(10);
    expect(live()).toHaveLength(1);
    expect(`moduli_${live()[0].tokenId}_s`).toBe(last);
  });

  it("the one it just returned is NEVER the one it retires", async () => {
    await ask();
    const second = (await (await ask()).json()).token;
    // The token in the caller's hand has to still authenticate, or the drawer
    // connects with a credential the same request just killed.
    const { default: ApiToken } = await import("../models/ApiToken.js");
    expect(await ApiToken.authenticate(second)).toBeTruthy();
  });

  it("retires only THIS user's auto tokens", async () => {
    rows.push({ tokenId: "other-user", userId: "u2", name: "assistant (auto)", scopes: ["read", "write"], revoked: false });
    await ask();
    expect(rows.find((r) => r.tokenId === "other-user").revoked).toBe(false);
  });

  // The control that keeps this from becoming a token-sweeper: a token the user
  // made by hand is not machine-minted noise and must survive untouched.
  it("never touches a token the user named themselves", async () => {
    rows.push({ tokenId: "mine", userId: "u1", name: "Chrome extension", scopes: ["read", "write"], revoked: false });
    await ask();
    await ask();
    expect(rows.find((r) => r.tokenId === "mine").revoked).toBe(false);
    expect(updateManyCalls.every((c) => c.filter.name === "assistant (auto)")).toBe(true);
  });

  // The whole branch is a FALLBACK. With a valid env token nothing is minted,
  // so the sweep never runs and there is nothing to bound.
  it("mints nothing at all when the env token still works", async () => {
    rows.push({ tokenId: "envtok", userId: "u1", name: "assistant", scopes: ["read", "write"], revoked: false });
    process.env.ASSISTANT_API_TOKEN = "moduli_envtok_s";
    const b = await (await ask()).json();
    expect(b.token).toBe("moduli_envtok_s");
    expect(rows.filter((r) => r.name === "assistant (auto)")).toHaveLength(0);
    expect(updateManyCalls).toHaveLength(0);
  });
});
