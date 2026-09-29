// server/__tests__/apiSharePreview.test.js
//
// Auto must say where it will put the thing BEFORE you press Clip. The whole
// feature exists because a clip went somewhere the user could not find; a mode
// called "auto" that will not say where is the same failure with a nicer name.
//
// It resolves on the SERVER, through selectShareRules — the function the real
// run uses. A second matcher in the page would be free to disagree with it.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../models/Grid.js", () => ({ default: {
  exists: async (q) => (q._id === "g1" && q.userId === "u1" ? { _id: "g1" } : null),
}}));
// The extension stages its GESTURE as `shape` ("page" for a page clip) — not
// the share type. The type comes from the url, as prepareShare decides it.
let STAGED = { url: "https://www.imdb.com/title/tt0473488/", shape: "page" };
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000,
  createStage: async () => ({ stageId: "s1", key: "k1" }),
  readStage: async (id, key, opts) => (id === "s1" && key === "k1"
    ? (opts?.withUser ? { payload: STAGED, userId: "u1" } : STAGED)
    : null),
  consumeStage: async () => null,
}));
vi.mock("../models/Operation.js", () => ({ default: {
  find: () => ({ lean: async () => ([
    { id: "r-all", name: "Share: anything else", enabled: true, triggerObjects: [{ eventType: "onShare", shareType: "*" }],
      pipeline: { steps: [{ type: "action", config: { type: "CREATE", parentFolderId: "fold-files" } }] } },
    { id: "r-link", name: "Share: link", enabled: true, triggerObjects: [{ eventType: "onShare", shareType: "link" }],
      pipeline: { steps: [{ type: "if", then: [{ type: "action", config: { type: "CREATE", parentId: "literal:o-bm" } }] }] } },
    { id: "r-text", name: "Share: text", enabled: true, triggerObjects: [{ eventType: "onShare", shareType: "text" }],
      pipeline: { steps: [{ type: "action", config: { type: "CREATE", parentId: "$inbox" } }] } },
  ]) }),
}}));
vi.mock("../models/User.js", () => ({ default: { findById: () => ({ lean: async () => null }) } }));
vi.mock("../models/Folder.js", () => ({ default: {
  findOne: () => ({ lean: async () => ({ id: "fold-files", name: "Files" }) }),
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => (q.id === "o-bm" ? { id: "o-bm", moduleId: "m-bm" } : null) }),
}}));
vi.mock("../models/Module.js", () => ({ default: {
  findOne: () => ({ lean: async () => ({ id: "m-bm", label: "Bookmarks" }) }),
}}));

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

const preview = (q) => fetch(`${base}/share/stage/s1/preview?${q}`);

describe("GET /share/stage/:id/preview", () => {
  it("names the typed rule, not the catch-all — for a PAGE clip, whose shape is not a type", async () => {
    STAGED = { url: "https://www.imdb.com/title/tt0473488/", shape: "page" };
    const r = await preview("k=k1&gridId=g1");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ type: "link", ruleId: "r-link", ruleName: "Share: link", then: ["Share: anything else"] });
  });

  it("says where the rule files it, through its module's label", async () => {
    STAGED = { url: "https://x.com/a", shape: "link" };
    expect((await (await preview("k=k1&gridId=g1")).json()).lands).toBe("Bookmarks");
  });

  it("a selection with no url is a TEXT share", async () => {
    STAGED = { text: "a quote worth keeping", shape: "selection" };
    const body = await (await preview("k=k1&gridId=g1")).json();
    expect(body).toMatchObject({ type: "text", ruleId: "r-text" });
    expect(body.lands).toBeNull(); // a $var destination is not guessed at
  });

  it("404s on a wrong key, like every other stage read", async () => {
    expect((await preview("k=no&gridId=g1")).status).toBe(404);
  });

  it("with no gridId, uses the grid /share would pick — so a signed-out window still names the rule", async () => {
    STAGED = { url: "https://x.com/a", shape: "link", gridId: "g1" };
    const r = await preview("k=k1");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ gridId: "g1", ruleId: "r-link" });
  });

  it("with no gridId anywhere, says so rather than guessing", async () => {
    STAGED = { url: "https://x.com/a", shape: "link" };
    expect((await preview("k=k1")).status).toBe(400);
  });

  it("will not read another user's grid's rules", async () => {
    expect((await preview("k=k1&gridId=g-other")).status).toBe(404);
  });
});
