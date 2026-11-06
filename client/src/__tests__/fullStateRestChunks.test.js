// @vitest-environment jsdom
// The CLIENT half of the progressive load: how the deferred catalogue's chunks
// reach the store.
//
// The server splits the artifact catalogue into 4 x 4,000 so one 16 MB frame
// does not move the stall from parse to inflate (socketHandlers/state.js). That
// is a decision about the WIRE. It was also driving four STORE writes, and each
// one swaps `state.occurrences` identity — so every option-resolving field pill
// re-rendered once per chunk, for rows nothing on screen places. Measured on
// prod at the tablet's viewport, landing at 5.2-6.8s (after the grid is up):
//
//     chunk 1  448 renders (210 container + 223 field)
//     chunk 2  235   ·   chunk 3  235   ·   chunk 4  235
//
// These pin the coalescing AND its fail-open, which is the half that matters:
// holding the catalogue forever is a worse failure than the re-renders removed.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { bindSocketToStore } from "../state/bindSocketToStore";
import { ActionTypes } from "../state/actions";

const localStorageStore = {};
vi.stubGlobal("localStorage", {
  getItem: (k) => localStorageStore[k] ?? null,
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: (k) => { delete localStorageStore[k]; },
});

function makeMockSocket() {
  const listeners = {};
  return {
    on(e, fn) { listeners[e] = fn; },
    emit() {},
    _trigger(e, ...a) { if (listeners[e]) listeners[e](...a); },
  };
}

function setup() {
  const socket = makeMockSocket();
  const dispatched = [];
  const stateRef = { current: { modules: [], occurrences: [], operations: [], fields: [] } };
  bindSocketToStore(socket, (a) => dispatched.push(a), stateRef);
  return { socket, dispatched };
}

/** Start a load whose deferred half is still outstanding. */
function beginDeferredLoad(socket, gridId = "g1") {
  socket._trigger("full_state", {
    gridId, modules: [], occurrences: [], fields: [], operations: [], deferredCount: 12000,
  });
}

const restOf = (dispatched) => dispatched.filter((a) => a.type === ActionTypes.FULL_STATE_REST);
const occ = (id) => ({ id, moduleId: "ma" });

describe("deferred catalogue chunks", () => {
  beforeEach(() => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]); });
  afterEach(() => { vi.useRealTimers(); });

  test("four chunks produce exactly ONE store write, carrying every row in order", () => {
    const { socket, dispatched } = setup();
    beginDeferredLoad(socket);
    for (let i = 1; i <= 4; i++) {
      socket._trigger("full_state_rest", {
        gridId: "g1",
        occurrences: [occ(`a${i}`)],
        modules: i === 1 ? [{ id: "ma", role: "artifact" }] : [],
        chunk: i, chunks: 4, done: i === 4,
      });
    }
    const rests = restOf(dispatched);
    expect(rests).toHaveLength(1);
    expect(rests[0].payload.occurrences.map((o) => o.id)).toEqual(["a1", "a2", "a3", "a4"]);
    // Every module rides with the FIRST chunk, so a coalescer that kept only
    // the last chunk's payload would silently drop them and leave every
    // artifact placement module-less.
    expect(rests[0].payload.modules.map((m) => m.id)).toEqual(["ma"]);
  });

  // THE CONTROL for the test above: without it, "one dispatch" is also
  // satisfied by a build that dispatches nothing at all.
  test("a chunk that is not the last writes NOTHING yet", () => {
    const { socket, dispatched } = setup();
    beginDeferredLoad(socket);
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("a1")], chunk: 1, chunks: 4, done: false });
    expect(restOf(dispatched)).toHaveLength(0);
  });

  test("FAILS OPEN: chunks that never complete are still dispatched by the fallback", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { socket, dispatched } = setup();
    beginDeferredLoad(socket);
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("a1"), occ("a2")], chunk: 1, chunks: 4, done: false });
    expect(restOf(dispatched)).toHaveLength(0);

    // 15s from the REQUEST, which goes out a frame after the paint (2026-11-06).
    vi.advanceTimersByTime(15100);

    const rests = restOf(dispatched);
    expect(rests).toHaveLength(1);
    expect(rests[0].payload.occurrences.map((o) => o.id)).toEqual(["a1", "a2"]);
    warn.mockRestore();
  });

  test("the fallback writes nothing when no chunk ever arrived", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { socket, dispatched } = setup();
    beginDeferredLoad(socket);
    vi.advanceTimersByTime(15000);
    expect(restOf(dispatched)).toHaveLength(0);
    warn.mockRestore();
  });

  test("a late chunk for ANOTHER grid is never merged in", () => {
    const { socket, dispatched } = setup();
    beginDeferredLoad(socket, "g1");
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("a1")], chunk: 1, chunks: 2, done: false });
    socket._trigger("full_state_rest", { gridId: "OTHER", occurrences: [occ("x1")], chunk: 1, chunks: 1, done: true });
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("a2")], chunk: 2, chunks: 2, done: true });
    const rests = restOf(dispatched);
    expect(rests).toHaveLength(1);
    expect(rests[0].payload.occurrences.map((o) => o.id)).toEqual(["a1", "a2"]);
  });

  test("a new full_state drops the previous grid's held chunks", () => {
    const { socket, dispatched } = setup();
    beginDeferredLoad(socket, "g1");
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("stale")], chunk: 1, chunks: 2, done: false });
    beginDeferredLoad(socket, "g2");
    socket._trigger("full_state_rest", { gridId: "g2", occurrences: [occ("fresh")], chunk: 1, chunks: 1, done: true });
    const rests = restOf(dispatched);
    expect(rests).toHaveLength(1);
    expect(rests[0].payload.occurrences.map((o) => o.id)).toEqual(["fresh"]);
  });

  // A date change at first paint kept the page busy until the request for the rest went out at 37s; the 15s fallback,
  // started when the first half arrived, had already run the load on half the grid (the day's Schedule column was
  // never built). The 15s is the server's, so it starts at the request (2026-11-06).
  test("the fallback waits for the request: a page too busy to ask does not give up on the server", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // no animation frame: the request has not gone out
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { socket } = setup();
    beginDeferredLoad(socket);
    vi.advanceTimersByTime(30000);
    expect(warn.mock.calls.some((c) => /never completed/.test(String(c[0])))).toBe(false);
    vi.advanceTimersByTime(31000); // the long grace still fails open for a request that never goes out
    expect(warn.mock.calls.some((c) => /never completed/.test(String(c[0])))).toBe(true);
    warn.mockRestore();
  });

  test("once asked, the server has 15s", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { socket } = setup();
    beginDeferredLoad(socket);
    vi.advanceTimersByTime(15100);
    expect(warn.mock.calls.some((c) => /never completed/.test(String(c[0])))).toBe(true);
    warn.mockRestore();
  });

  test("a rest that lands after the fallback runs the load sweep again over the whole grid", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { socket, dispatched } = setup();
    beginDeferredLoad(socket);
    vi.advanceTimersByTime(15100);
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("late1")], chunk: 1, chunks: 2, done: false });
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("late2")], chunk: 2, chunks: 2, done: true });
    expect(restOf(dispatched).at(-1).payload.occurrences.map((o) => o.id)).toEqual(["late1", "late2"]);
    expect(warn.mock.calls.some((c) => /running the load sweep again/.test(String(c[0])))).toBe(true);
    warn.mockRestore();
  });

  // The server sends every chunk at once; on a busy page they wait in the socket's queue and the timer can reach the
  // main thread first. A timer that fires LATE says the page was busy, not that the server went quiet (2026-11-06).
  test("a fallback that fires late waits another round instead of sweeping half the grid", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { socket, dispatched } = setup();
    beginDeferredLoad(socket);
    vi.advanceTimersByTime(20); // the request goes out
    vi.setSystemTime(Date.now() + 25000); // the page is busy for 25s: the clock moves, the timer has not run yet
    vi.advanceTimersByTime(15100); // now it runs, 10s late
    expect(warn.mock.calls.some((c) => /never completed/.test(String(c[0])))).toBe(false);
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("r1")], chunk: 1, chunks: 1, done: true });
    expect(restOf(dispatched).at(-1).payload.occurrences.map((o) => o.id)).toEqual(["r1"]);
    expect(warn.mock.calls.some((c) => /running the load sweep again/.test(String(c[0])))).toBe(false);
    warn.mockRestore();
  });

  test("a fallback while the socket is down waits for it", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { socket } = setup();
    beginDeferredLoad(socket);
    socket.connected = false;
    vi.advanceTimersByTime(15100);
    expect(warn.mock.calls.some((c) => /never completed/.test(String(c[0])))).toBe(false);
    socket.connected = true;
    vi.advanceTimersByTime(15100);
    expect(warn.mock.calls.some((c) => /never completed/.test(String(c[0])))).toBe(true);
    warn.mockRestore();
  });

  // The second pass rebuilt from the DOWNLOAD and cleared the overlay, so it could not see what the first pass made and
  // made it again (45 duplicate routine items in Monday's column, 2026-11-06).
  test("the second pass over the whole grid keeps what the first pass made and leaves out what it deleted", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { socket } = setup();
    socket._trigger("full_state", { gridId: "g1", modules: [], occurrences: [occ("kept"), occ("gone")], fields: [], operations: [], deferredCount: 10 });
    vi.advanceTimersByTime(15100); // fallback: the first pass runs on half the grid
    const { operationsBridge } = await import("../state/bindSocketToStore.js");
    operationsBridge.updateLocalOcc({ id: "made", moduleId: "ma" }); // the first pass created a row …
    operationsBridge.removeLocalOcc("gone"); // … and deleted one
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("late")], chunk: 1, chunks: 1, done: true });
    expect(operationsBridge.getLocalOcc("made")).toBeTruthy();
    expect(operationsBridge.getLocalOcc("late")).toBeTruthy();
    expect(operationsBridge.getLocalOcc("kept")).toBeTruthy();
    expect(operationsBridge.getLocalOcc("gone")).toBeNull();
    warn.mockRestore();
  });
});
