// THE LOAD SWEEP RUNS TWICE — ONCE ON THE CORE STATE, ONCE ON THE CATALOGUE.
//
// It used to WAIT for the deferred artifact catalogue, and on the device that
// wait is most of a 30-second load tail: a drag begun 18s after load reads
// `fps=4`, 82% blocked, with `opBy=[load:1x2861ms/236fx]` — the sweep still
// running. `ops:start` is 4.6s on the probe and ~15s on the tablet.
//
// `sweepWithoutCatalogue.test.js` is what makes running it twice safe: over the
// live grid's own 71 pipelines, exactly 6 of 371 effects differ without the
// catalogue (one op, the media counters), and the second pass creates NOTHING.
// This file pins the WIRING that suite cannot see — that pass 1 fires before a
// single chunk has arrived, and that pass 2 fires after `done`.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const sweeps = [];
vi.mock("../helpers/operationExecutor", () => ({
  runMatchingOperations: () => [],
  // The load path calls the SLICED driver; record the occurrence map each pass
  // was handed so "which rows could it see" is answerable, not assumed.
  runMatchingOperationsSliced: (ops, _t, _tx, ctx) => {
    sweeps.push({ ids: Object.keys(ctx?.occurrencesById || {}) });
    return Promise.resolve([]);
  },
  executeOperation: () => [],
  executePipeline: () => [],
  setOpApplyingEffects: () => {},
  snapshotOpsApplying: () => new Set(),
  markOpsApplying: () => {},
}));

const { bindSocketToStore } = await import("../state/bindSocketToStore");

const store = {};
vi.stubGlobal("localStorage", {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
});
// `afterPaint` is rAF THEN a macrotask; jsdom has no rAF by default.
vi.stubGlobal("requestAnimationFrame", (fn) => setTimeout(fn, 0));

function setup() {
  const listeners = {};
  const socket = {
    on(e, fn) { listeners[e] = fn; },
    emit() {},
    _trigger(e, ...a) { listeners[e]?.(...a); },
  };
  const stateRef = { current: { modules: [], occurrences: [], operations: [], fields: [] } };
  bindSocketToStore(socket, () => {}, stateRef);
  return socket;
}

const occ = (id) => ({ id, moduleId: "ma" });
/** The sweep is deferred behind rAF + a 50ms macrotask; drain both. */
const settle = async () => { for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(60); await Promise.resolve(); } };

describe("the load sweep runs on the core state, then again on the catalogue", () => {
  beforeEach(() => { sweeps.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("pass 1 fires BEFORE any catalogue chunk has arrived", async () => {
    const socket = setup();
    socket._trigger("full_state", {
      gridId: "g1", modules: [], fields: [], operations: [{ id: "o1" }],
      occurrences: [occ("core1"), occ("core2")], deferredCount: 8000,
    });
    await settle();
    // The whole point: one sweep, already run, with no chunk delivered.
    expect(sweeps.length).toBe(1);
    expect(sweeps[0].ids.sort()).toEqual(["core1", "core2"]);
  });

  test("pass 2 fires when the catalogue completes, and SEES both halves", async () => {
    const socket = setup();
    socket._trigger("full_state", {
      gridId: "g1", modules: [], fields: [], operations: [{ id: "o1" }],
      occurrences: [occ("core1")], deferredCount: 2,
    });
    await settle();
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("art1")], modules: [] });
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("art2")], modules: [], done: true });
    await settle();
    expect(sweeps.length).toBe(2);
    // Pass 2 must see the catalogue — otherwise the media counters it exists
    // to compute would read zero and the split would be pointless.
    expect(sweeps[1].ids.sort()).toEqual(["art1", "art2", "core1"]);
  });

  test("a grid with NO deferred half still runs exactly one sweep — the control", async () => {
    // Without this, "the sweep runs twice" could be satisfied by a build that
    // sweeps twice on every load, deferred half or not.
    const socket = setup();
    socket._trigger("full_state", {
      gridId: "g1", modules: [], fields: [], operations: [{ id: "o1" }],
      occurrences: [occ("core1")], deferredCount: 0,
    });
    await settle();
    expect(sweeps.length).toBe(1);
  });

  test("pass 2 does NOT reset the overlay — it keeps what pass 1 built", async () => {
    // THE MOST DANGEROUS LINE IN THE CHANGE. The overlay is where pass 1's
    // creates live; resetting it on pass 2 means pass 2 cannot see them and
    // RE-CREATES every one. That is not hypothetical — 2026-08-31 (2) records
    // exactly this shape on live data: a day column re-copied on every load,
    // +49 occurrences each time, growing without bound.
    //
    // A row minted BETWEEN the passes stands in for pass 1's own creates: it
    // reaches the overlay through `occurrence_created`, the same chokepoint
    // every write uses, and it is absent from both payload halves — so if it
    // survives into pass 2's context, the overlay was carried across.
    const socket = setup();
    socket._trigger("full_state", {
      gridId: "g1", modules: [], fields: [], operations: [{ id: "o1" }],
      occurrences: [occ("core1")], deferredCount: 2,
    });
    await settle();
    socket._trigger("occurrence_created", { occurrence: occ("mintedBySweep") });
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("art1")], modules: [], done: true });
    await settle();
    expect(sweeps.length).toBe(2);
    expect(sweeps[1].ids).toContain("mintedBySweep");
  });

  test("FAIL OPEN: chunks that never complete still get a second pass", async () => {
    const socket = setup();
    socket._trigger("full_state", {
      gridId: "g1", modules: [], fields: [], operations: [{ id: "o1" }],
      occurrences: [occ("core1")], deferredCount: 9000,
    });
    await settle();
    socket._trigger("full_state_rest", { gridId: "g1", occurrences: [occ("art1")], modules: [] });
    vi.advanceTimersByTime(16000); // past REST_FALLBACK_MS
    await settle();
    expect(sweeps.length).toBe(2);
    expect(sweeps[1].ids).toContain("art1");
  });
});
