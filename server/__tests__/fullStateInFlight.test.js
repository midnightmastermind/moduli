// A grid switch re-asks every 8s until the grid arrives, and each ask re-collected and re-sent the whole grid (~55,000
// rows on poms) on one thread. Measured on prod 2026-11-05: 7 asks, first answer at 57s, answers logged at 136-673s, the
// same deferred send stacked 16 times. A socket's repeat for the grid it is already answering is now dropped.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findOne = vi.fn();
vi.mock("../models/Grid.js", () => ({ default: { findOne: (...a) => findOne(...a), exists: vi.fn() } }));

vi.mock("../models/User.js", () => ({ default: { findById: () => ({ select: () => ({ lean: async () => ({ email: "a@b.c" }) }) }) } }));
vi.mock("../utils/userManifest.js", () => ({ ensureUserManifest: async () => ({}) }));
vi.mock("../utils/protectedFoldersEnsure.js", () => ({ ensureProtectedFolders: async () => {} }));
vi.mock("../socketHandlers/feedLeader.js", () => ({ joinFeedGroup: () => {} }));
vi.mock("../utils/splitFullState.js", () => ({
  splitShownFirst: () => ({ core: [], deferred: [{ id: "later", gridId: "g1" }], coreModules: [], deferredModules: [] }),
  holdBackText: (core) => ({ core, textmaps: {} }),
  templateRootIds: () => [],
}));

const { registerStateHandlers, fullStateKey } = await import("../socketHandlers/state.js");

function fakeSocket() {
  const handlers = {};
  const emitted = [];
  return {
    userId: "u1", data: {},
    on: (ev, fn) => { handlers[ev] = fn; },
    once: (ev, fn) => { handlers[ev] = fn; },
    off: (ev) => { delete handlers[ev]; },
    join: () => {}, leave: () => {},
    emit: (ev, payload) => emitted.push([ev, payload]),
    fire: (ev, payload) => handlers[ev](payload),
    emitted,
  };
}
/** A Grid.findOne whose answer the test releases by hand. */
function pendingFind() {
  let release;
  const p = new Promise((res, rej) => { release = rej; });
  findOne.mockImplementationOnce(() => ({ maxTimeMS: () => ({ lean: () => p }) }));
  return () => release(new Error("stop here"));
}

beforeEach(() => { findOne.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });

describe("request_full_state while the same answer is being built", () => {
  it("a repeat for the same grid does no work", async () => {
    const s = fakeSocket(); registerStateHandlers(s, {});
    const release = pendingFind();
    const first = s.fire("request_full_state", { gridId: "g1" });
    await s.fire("request_full_state", { gridId: "g1" });
    await s.fire("request_full_state", { gridId: "g1" });
    expect(findOne).toHaveBeenCalledTimes(1);
    release(); await first;
  });
  it("a request for ANOTHER grid goes ahead — the user moved on", async () => {
    const s = fakeSocket(); registerStateHandlers(s, {});
    const r1 = pendingFind(); const r2 = pendingFind();
    const a = s.fire("request_full_state", { gridId: "g1" });
    const b = s.fire("request_full_state", { gridId: "g2" });
    expect(findOne).toHaveBeenCalledTimes(2);
    r1(); r2(); await a; await b;
  });
  it("once it has finished, even by failing, the same grid can be asked again — the retry's actual job", async () => {
    const s = fakeSocket(); registerStateHandlers(s, {});
    const r1 = pendingFind();
    const a = s.fire("request_full_state", { gridId: "g1" });
    r1(); await a;
    expect(s.emitted.some(([e]) => e === "server_error")).toBe(true);
    const r2 = pendingFind();
    const b = s.fire("request_full_state", { gridId: "g1" });
    expect(findOne).toHaveBeenCalledTimes(2);
    r2(); await b;
  });
  it("another socket is not held back by this one", async () => {
    const a = fakeSocket(); const b = fakeSocket(); registerStateHandlers(a, {}); registerStateHandlers(b, {});
    const r1 = pendingFind(); const r2 = pendingFind();
    const x = a.fire("request_full_state", { gridId: "g1" });
    const y = b.fire("request_full_state", { gridId: "g1" });
    expect(findOne).toHaveBeenCalledTimes(2);
    r1(); r2(); await x; await y;
  });
  it("no grid named is its own key", () => {
    expect(fullStateKey(undefined)).toBe(fullStateKey(null));
    expect(fullStateKey("g1")).not.toBe(fullStateKey(null));
  });
});

/** Everything a request needs to reach its answer. */
const answeringDeps = () => ({
  userCacheReady: () => true,
  ensureUserCache: () => ({ occurrencesById: {}, modulesById: {}, fieldsById: {}, manifestsById: {}, viewsById: {}, foldersById: {}, operationsById: {} }),
  getAllGridsForUser: async () => [],
  gridRoom: (u, g) => `${u}:${g}`,
  io: {},
});
const foundGrid = (id = "g1") => findOne.mockImplementation(() => ({ maxTimeMS: () => ({ lean: async () => ({ _id: id, occurrences: [] }) }) }));
const count = (s, ev) => s.emitted.filter(([e]) => e === ev).length;

describe("after the answer has gone out", () => {
  it("the client's RETRY of an answered grid is dropped: socket.io delivers in order, the answer is on its way", async () => {
    const s = fakeSocket(); registerStateHandlers(s, answeringDeps()); foundGrid();
    await s.fire("request_full_state", { gridId: "g1" });
    await s.fire("request_full_state", { gridId: "g1", retry: true });
    expect(count(s, "full_state")).toBe(1);
  });
  it("a plain request for the same grid is still answered: an undo resync needs the new state", async () => {
    const s = fakeSocket(); registerStateHandlers(s, answeringDeps()); foundGrid();
    await s.fire("request_full_state", { gridId: "g1" });
    await s.fire("request_full_state", { gridId: "g1" });
    expect(count(s, "full_state")).toBe(2);
  });
  it("a retry after moving to ANOTHER grid and back is answered", async () => {
    const s = fakeSocket(); registerStateHandlers(s, answeringDeps()); foundGrid();
    await s.fire("request_full_state", { gridId: "g1" });
    await s.fire("request_full_state", { gridId: "g2" });
    await s.fire("request_full_state", { gridId: "g1", retry: true });
    expect(count(s, "full_state")).toBe(3);
  });
  it("two answers leave ONE deferred send waiting, not two (16 of them stacked on prod)", async () => {
    vi.useFakeTimers();
    try {
      const s = fakeSocket(); registerStateHandlers(s, answeringDeps()); foundGrid();
      await s.fire("request_full_state", { gridId: "g1" });
      await s.fire("request_full_state", { gridId: "g1" });
      await vi.advanceTimersByTimeAsync(10000);
      expect(count(s, "full_state_rest")).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
