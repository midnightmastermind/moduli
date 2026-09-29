// server/__tests__/apiShareManual.test.js
//
// Two additions to /share, and the reason they belong on /share rather than on
// a new endpoint: a hand-placed clip must appear in the SAME share log the
// Imports tab shows, beside every automatic one.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../models/ApiToken.js", () => ({ default: {
  authenticate: async (raw) => (raw === "good-token" ? { userId: "u1", scopes: ["read", "write"], tokenId: "t" } : null),
}}));
vi.mock("../models/Grid.js", () => ({ default: {
  exists: async (q) => (q._id === "g1" && q.userId === "u1" ? { _id: "g1" } : null),
  findOneAndUpdate: () => ({ lean: async () => ({ shareLog: [] }) }),
}}));
vi.mock("../models/User.js", () => ({ default: { findById: () => ({ lean: async () => null }) } }));
vi.mock("../utils/shareRulesEnsure.js", () => ({ ensureCatchAllRule: async () => ({ created: false }) }));
const prepared = [];
vi.mock("../services/shareIngress.js", () => ({
  prepareShare: async (a) => (prepared.push(a), { type: "link", label: a.title || "L", externalId: "link:x", props: { url: a.url } }),
}));
const rulesRan = [];
vi.mock("../services/shareRules.js", () => ({
  runShareRules: async () => { rulesRan.push(1); return { ran: [], halted: false }; },
}));
const placed = [];
vi.mock("../services/manualPlacement.js", () => ({
  placeManually: async (a) => {
    placed.push(a);
    return { ran: [{ ruleId: "manual", ruleName: "Placed by hand", ok: true, created: [{ occurrenceId: "new-1" }] }], halted: true };
  },
}));
const logged = [];
vi.mock("../services/shareLog.js", () => ({
  shareLogEntry: (a) => a,
  recordShare: async (a) => { logged.push(a); },
}));
const consumed = [];
const released = [];
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000,
  createStage: async () => ({ stageId: "s1", key: "k1" }),
  readStage: async () => null,
  releaseStage: async (id) => { released.push(id); },
  consumeStage: async (id, key, opts) => {
    consumed.push({ id, key });
    if (id === "s1" && key === "k1") return opts?.withUser ? { payload: { url: "https://x" }, userId: "u1" } : { url: "https://x" };
    return null;
  },
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

const share = (body, token) => fetch(`${base}/share`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

const MANUAL = {
  gridId: "g1", url: "https://imdb/x", mode: "manual",
  placement: { parentId: "0cti", role: "artifact", kind: "movie", fields: { "f-year": "2006" } },
};

describe("mode: manual", () => {
  it("places instead of running the rules", async () => {
    rulesRan.length = 0; placed.length = 0;
    const r = await share(MANUAL, "good-token");
    expect(r.status).toBe(201);
    expect(placed).toHaveLength(1);
    expect(rulesRan).toHaveLength(0);
  });

  it("passes the placement straight through", async () => {
    placed.length = 0;
    await share(MANUAL, "good-token");
    expect(placed[0].placement).toMatchObject({ parentId: "0cti", kind: "movie" });
  });

  it("STILL writes to the share log — the Imports tab shows hand placements too", async () => {
    logged.length = 0;
    await share(MANUAL, "good-token");
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0])).toMatch(/Placed by hand/);
  });

  it("refuses a manual share with no placement", async () => {
    const r = await share({ ...MANUAL, placement: null }, "good-token");
    expect(r.status).toBe(400);
  });

  it("an unknown mode is refused rather than silently running the rules", async () => {
    const r = await share({ ...MANUAL, mode: "sideways" }, "good-token");
    expect(r.status).toBe(400);
  });
});

describe("stage-key authorization", () => {
  it("accepts a valid stageId + stageKey with NO bearer token", async () => {
    const r = await share({ ...MANUAL, stageId: "s1", stageKey: "k1" });
    expect(r.status).toBe(201);
  });

  it("refuses a wrong key", async () => {
    const r = await share({ ...MANUAL, stageId: "s1", stageKey: "wrong" });
    expect(r.status).toBe(401);
  });

  it("refuses a reused stage — the commit consumed it", async () => {
    // consumeStage returns null the second time in the real service; here the
    // mock is asked for a stage that does not exist, which is the same answer.
    const r = await share({ ...MANUAL, stageId: "s-gone", stageKey: "k1" });
    expect(r.status).toBe(401);
  });

  it("a bearer token still works and does not need a stage", async () => {
    const r = await share(MANUAL, "good-token");
    expect(r.status).toBe(201);
  });
});

describe("what a stage key can write", () => {
  it("the CONTENT comes from the stage, not the request body", async () => {
    // The key authorizes placing THAT clip. A body carrying a different url
    // must not turn it into a one-shot write of anything, anywhere.
    prepared.length = 0;
    const r = await share({ ...MANUAL, url: "https://evil/elsewhere", title: "not the clip", stageId: "s1", stageKey: "k1" });
    expect(r.status).toBe(201);
    expect(prepared[0].url).toBe("https://x");
    expect(prepared[0].title).toBe(null);
  });

  it("a stage key wins over a bearer token — a session cannot place one stage twice", async () => {
    consumed.length = 0;
    const r = await share({ ...MANUAL, stageId: "s-gone", stageKey: "k1" }, "good-token");
    expect(r.status).toBe(401);
    expect(consumed).toHaveLength(1);
  });

  it("a refused commit gives the stage back, so the window can be fixed and retried", async () => {
    released.length = 0;
    const r = await share({ ...MANUAL, placement: null, stageId: "s1", stageKey: "k1" });
    expect(r.status).toBe(400);
    expect(released).toEqual(["s1"]);
  });
});
