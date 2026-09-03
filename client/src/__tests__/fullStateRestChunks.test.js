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

    vi.advanceTimersByTime(15000);

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
});
