// server/__tests__/shareStage.test.js
//
// The stage holds a clip for the ten minutes between clipping it and placing
// it. Its KEY is the authorization — the placement window may be open in a
// browser that is not signed in — so the cases that matter are the refusals.
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows = [];
vi.mock("../models/ShareStage.js", () => ({ default: {
  create: async (doc) => { rows.push({ ...doc }); return doc; },
  findOne: (q) => ({ lean: async () => rows.find((r) => r.id === q.id) || null }),
  updateOne: async (q, u) => {
    const r = rows.find((x) => x.id === q.id);
    if (r && u.$set) Object.assign(r, u.$set);
    return { modifiedCount: r ? 1 : 0 };
  },
}}));

const { createStage, readStage, consumeStage, STAGE_TTL_MS } = await import("../services/shareStage.js");

beforeEach(() => { rows = []; });

describe("createStage", () => {
  it("returns an id and a key, and stores neither in plain sight of the other", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(stageId).toBeTruthy();
    expect(key).toBeTruthy();
    expect(key).not.toBe(stageId);
    expect(key.length).toBeGreaterThanOrEqual(32);
  });

  it("writes an expiry ten minutes out", async () => {
    const before = Date.now();
    await createStage({ userId: "u1", payload: {} });
    const exp = rows[0].expiresAt.getTime();
    expect(exp).toBeGreaterThanOrEqual(before + STAGE_TTL_MS - 1000);
    expect(exp).toBeLessThanOrEqual(Date.now() + STAGE_TTL_MS + 1000);
  });
});

describe("readStage", () => {
  it("returns the payload for the right key", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(await readStage(stageId, key)).toMatchObject({ url: "https://x" });
  });

  it("refuses a WRONG key — the case that matters, since the key IS the auth", async () => {
    const { stageId } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(await readStage(stageId, "not-the-key")).toBeNull();
    expect(await readStage(stageId, "")).toBeNull();
    expect(await readStage(stageId, undefined)).toBeNull();
  });

  it("refuses an unknown stage", async () => {
    expect(await readStage("nope", "k")).toBeNull();
  });

  it("refuses an EXPIRED stage even with the right key", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: {} });
    rows[0].expiresAt = new Date(Date.now() - 1);
    expect(await readStage(stageId, key)).toBeNull();
  });

  it("does NOT consume — the window reads before you have decided anything", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    await readStage(stageId, key);
    expect(await readStage(stageId, key)).toMatchObject({ url: "https://x" });
  });
});

describe("consumeStage", () => {
  it("returns the payload once and never again", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(await consumeStage(stageId, key)).toMatchObject({ url: "https://x" });
    expect(await consumeStage(stageId, key)).toBeNull();
    // And a read after the commit is refused too — the window is done.
    expect(await readStage(stageId, key)).toBeNull();
  });

  it("refuses a wrong key without consuming", async () => {
    const { stageId, key } = await createStage({ userId: "u1", payload: { url: "https://x" } });
    expect(await consumeStage(stageId, "wrong")).toBeNull();
    expect(await consumeStage(stageId, key)).toMatchObject({ url: "https://x" });
  });

  it("carries the userId, so the caller writes as the right person", async () => {
    const { stageId, key } = await createStage({ userId: "u7", payload: { url: "https://x" } });
    const { payload, userId } = await consumeStage(stageId, key, { withUser: true });
    expect(userId).toBe("u7");
    expect(payload).toMatchObject({ url: "https://x" });
  });
});
