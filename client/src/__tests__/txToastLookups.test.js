// Guards the transaction-toast lookup rewrite (2026-08-25). That block used to
// build fieldsById, modulesById, a FULL 21,000-key spread of occurrencesById and
// a parent reverse map on EVERY transaction — before it knew whether a toast
// would even be shown. One `Completed` toggle on poms grid produces 51 of them.
//
// The rewrite must change WHEN the lookups are built, never WHAT a toast says,
// so these tests pin both halves.
import { describe, test, expect, vi, beforeEach } from "vitest";
// vi.spyOn on an ESM namespace import does NOT intercept (recorded 2026-08-07)
// — the module has to be mocked.
const pushed = [];
vi.mock("../state/notificationStore", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {}, dismiss: () => {} }),
  pushTxNotification: (arg) => { pushed.push(arg); },
  pushOpNotification: () => {},
  notify: () => {},
}));
// Records every sweep so "did the echo re-fire operations?" is observable.
vi.mock("../helpers/operationExecutor", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runMatchingOperations: (ops, transactionType, ...rest) => {
      fired.push(transactionType);
      seenCtx.push(rest[1]);          // the context, so tests can read occurrencesById
      if (reFire.on) {
        // Stand in for an operation that writes the very field it triggers on —
        // the runaway loop _FIRE_DEPTH_LIMIT exists to stop.
        reFire.fn?.();
      }
      return actual.runMatchingOperations(ops, transactionType, ...rest);
    },
  };
});
import { byIdCached, bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";

const fired = [];
const reFire = { on: false, fn: null };
const seenCtx = [];
vi.stubGlobal("localStorage", {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
});

describe("byIdCached — keyed on the source ARRAY's identity", () => {
  test("returns the SAME map object for the same array — no rebuild per call", () => {
    const arr = [{ id: "a" }, { id: "b" }];
    const first = byIdCached(arr);
    expect(byIdCached(arr)).toBe(first);          // identity, not just equality
    expect(first.a).toBe(arr[0]);
  });

  test("a NEW array (what the reducer swaps in on a write) rebuilds", () => {
    const a1 = [{ id: "a", v: 1 }];
    const a2 = [{ id: "a", v: 2 }];
    expect(byIdCached(a2)).not.toBe(byIdCached(a1));
    expect(byIdCached(a2).a.v).toBe(2);           // and it is the NEW value
  });

  test("tolerates a missing/!array source and entries with no id", () => {
    expect(byIdCached(undefined)).toEqual({});
    expect(byIdCached(null)).toEqual({});
    expect(byIdCached([{ noId: 1 }, { id: "x" }])).toEqual({ x: { id: "x" } });
  });
});

// ─── the toast itself: same text as before the rewrite ──────────────────────
function makeSocket() {
  const listeners = {};
  return {
    on(e, fn) { listeners[e] = fn; },
    off() {}, emit() {},
    _trigger(e, ...a) { listeners[e]?.(...a); },
    _has(e) { return !!listeners[e]; },
  };
}

// A page › container › row chain, so chainForOcc has something to walk.
const STATE = {
  fields: [{ id: "f1", name: "Completed" }],
  modules: [
    { id: "m-page", label: "Schedule", role: "page" },
    { id: "m-slot", label: "7:30am", role: "container" },
    { id: "m-row",  label: "Hygiene", role: "instance" },
  ],
  occurrences: [],
  occurrencesById: {
    "o-page": { id: "o-page", moduleId: "m-page", occurrences: ["o-slot"] },
    "o-slot": { id: "o-slot", moduleId: "m-slot", occurrences: ["o-row"] },
    "o-row":  { id: "o-row",  moduleId: "m-row",  occurrences: [] },
  },
};

// POSITIONAL: bindSocketToStore(socket, dispatch, stateRef)
function bind() {
  const socket = makeSocket();
  bindSocketToStore(socket, () => {}, { current: STATE });
  return socket;
}

describe("transaction toast — the label is unchanged by the lazy rewrite", () => {
  beforeEach(() => { pushed.length = 0; });

  test("a MeasureOp whose value CHANGED still names chain · row · field: prev → next", () => {
    const socket = bind();
    expect(socket._has("transaction_created")).toBe(true);
    socket._trigger("transaction_created", {
      transaction: {
        id: "t1", type: "MeasureOp",
        operations: [{ type: "measure", measure: { occurrenceId: "o-row", fieldId: "f1", previousValue: false, value: true } }],
      },
    });
    const labels = pushed.map(c => c?.label).filter(Boolean);
    // STRICT — an assertion about a label proves nothing until the toast is
    // proven to happen at all. This is the positive control for the two
    // "pushes nothing" tests below.
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0]).toContain("Hygiene");     // nameForOcc  -> module label
    expect(labels[0]).toContain("Completed");   // fieldsById  -> field name
    expect(labels[0]).toContain("Schedule");    // chainForOcc -> the parent walk
  });

  test("an IDEMPOTENT MeasureOp (prev === next) pushes NO toast", () => {
    const socket = bind();
    if (!socket._has("transaction_created")) return;
    pushed.length = 0;
    socket._trigger("transaction_created", {
      transaction: {
        id: "t2", type: "MeasureOp",
        operations: [{ type: "measure", measure: { occurrenceId: "o-row", fieldId: "f1", previousValue: true, value: true } }],
      },
    });
    expect(pushed).toEqual([]);
  });

  test("a MeasureOp transaction does NOT re-fire operations — occurrence_updated owns that", () => {
    // The echo cannot match a field-scoped trigger anyway (it has
    // operations[].measure, not a `fields` map), so firing it only spins the
    // matcher over every operation on the grid. Measured: 90 sweeps / 3551ms
    // for one toggle before this guard.
    const socket = bind();
    expect(socket._has("transaction_created")).toBe(true);
    fired.length = 0;
    socket._trigger("transaction_created", {
      transaction: {
        id: "t4", type: "MeasureOp",
        operations: [{ type: "measure", measure: { occurrenceId: "o-row", fieldId: "f1", previousValue: false, value: true } }],
      },
    });
    expect(fired.filter(f => f === "MeasureOp")).toEqual([]);
  });

  test("CONTROL — a NON-MeasureOp transaction still fires operations", () => {
    // Without this the test above is vacuous: an empty `fired` would prove
    // nothing if the harness never reaches runMatchingOperations at all.
    const socket = bind();
    expect(socket._has("transaction_created")).toBe(true);
    fired.length = 0;
    socket._trigger("transaction_created", {
      transaction: {
        id: "t5", type: "EntityOp",
        operations: [{ type: "entity", entity: { action: "update", entityType: "module", entityId: "m-row" } }],
      },
    });
    expect(fired).toContain("EntityOp");
  });

  test("a SnapshotOp is still ignored outright — it is an undo record, not an event", () => {
    const socket = bind();
    if (!socket._has("transaction_created")) return;
    pushed.length = 0;
    socket._trigger("transaction_created", { transaction: { id: "t3", type: "SnapshotOp", operations: [] } });
    expect(pushed).toEqual([]);
  });
});

// ─── a field write paints before it recomputes ──────────────────────────────
describe("MeasureOp fires AFTER the paint, not during the click", () => {
  it("does not run the matcher synchronously, and does run it a frame later", async () => {
    bind();
    fired.length = 0;
    operationsBridge.fireOperations("MeasureOp", { occurrenceId: "o-row", fields: { f1: { value: true } } });
    expect(fired).toEqual([]);                 // the click handler is free to paint
    await new Promise((r) => setTimeout(r, 60));
    expect(fired).toContain("MeasureOp");      // nothing is skipped, only moved
  });

  it("CONTROL — a NavigationOp still fires synchronously", () => {
    bind();
    fired.length = 0;
    operationsBridge.fireOperations("NavigationOp", { type: "NavigationOp" });
    expect(fired).toContain("NavigationOp");   // the filter cascade must not be deferred
  });

  it("THE DEPTH CAP STILL TRIPS across the deferral — a runaway op loop stops", async () => {
    // This is the reason the deferral carries `_fireDepth`. Without it every
    // deferred fire restarts at depth 0 and _FIRE_DEPTH_LIMIT can never
    // accumulate, so a self-triggering operation spins forever in separate
    // tasks instead of being capped.
    bind();
    fired.length = 0;
    reFire.on = true;
    reFire.fn = () => operationsBridge.fireOperations("MeasureOp", { occurrenceId: "o-row", fields: { f1: { value: true } } });
    try {
      operationsBridge.fireOperations("MeasureOp", { occurrenceId: "o-row", fields: { f1: { value: true } } });
      await new Promise((r) => setTimeout(r, 400));
      // Measured: depth carried -> 8 (exactly _FIRE_DEPTH_LIMIT, the cap
      // tripping). Depth reset to 0 -> 23 and still climbing. A loose bound
      // here passes either way, which is how this test was vacuous at first.
      expect(fired.length).toBeGreaterThan(0);   // it really ran (not vacuous)
      expect(fired.length).toBeLessThanOrEqual(10);
    } finally {
      reFire.on = false; reFire.fn = null;
    }
  });
});

// ─── the base+local occurrence merge is cached; it must NOT go stale ────────
describe("the cached occurrencesById merge", () => {
  it("serves a FRESH value after a local occurrence changes", async () => {
    const socket = makeSocket();
    bindSocketToStore(socket, () => {}, { current: STATE });
    seenCtx.length = 0;

    // v1 lands in localOccsById via the real occurrence handler…
    socket._trigger("occurrence_updated", { occurrence: { id: "o-row", moduleId: "m-row", fields: { f1: { value: 1 } }, occurrences: [] } });
    await new Promise((r) => setTimeout(r, 60));
    // …then v2, a DIFFERENT object for the same id.
    socket._trigger("occurrence_updated", { occurrence: { id: "o-row", moduleId: "m-row", fields: { f1: { value: 2 } }, occurrences: [] } });
    await new Promise((r) => setTimeout(r, 60));

    const withRow = seenCtx.filter((c) => c?.occurrencesById?.["o-row"]);
    expect(withRow.length).toBeGreaterThan(0);          // positive control: fires happened
    const last = withRow[withRow.length - 1].occurrencesById["o-row"];
    expect(last.fields.f1.value).toBe(2);               // the cache did not serve v1
  });
});

describe("the cached merge also follows the BASE map", () => {
  it("a fire that does NOT touch the local overlay still sees a new base map", async () => {
    // This is the case the base-identity check exists for. An occurrence event
    // mutates localOccsById too, so its fingerprint alone would rebuild the
    // cache and mask the bug. A NavigationOp fire (grid filter change) touches
    // no local occurrence — if the base identity were ignored, operations would
    // run against the PREVIOUS occurrence map.
    const ref = { current: { ...STATE, gridId: "g1", grid: { _id: "g1" },
      occurrences: [{ id: "base-1", moduleId: "m-row", fields: {}, occurrences: [] }] } };
    const socket = makeSocket();
    bindSocketToStore(socket, () => {}, ref);

    seenCtx.length = 0;
    socket._trigger("grid_updated", { gridId: "g1", grid: { activeFilterValues: { d: "2026-08-25" } } });
    const first = seenCtx.filter(Boolean).pop();
    expect(first?.occurrencesById?.["base-1"]).toBeTruthy();   // control: it fired and saw the base
    expect(first?.occurrencesById?.["base-2"]).toBeFalsy();

    // New occurrences ARRAY — a reducer swap — and NO local occurrence write.
    ref.current = { ...ref.current, occurrences: [
      { id: "base-1", moduleId: "m-row", fields: {}, occurrences: [] },
      { id: "base-2", moduleId: "m-row", fields: {}, occurrences: [] },
    ] };
    seenCtx.length = 0;
    socket._trigger("grid_updated", { gridId: "g1", grid: { activeFilterValues: { d: "2026-08-26" } } });
    const after = seenCtx.filter(Boolean).pop();
    expect(after).toBeTruthy();                                 // it fired again
    expect(after.occurrencesById["base-2"]).toBeTruthy();        // …and the base is fresh
  });
});

// ─── getAncestorChain caches its maps; they must not go stale ──────────────
describe("getAncestorChain", () => {
  it("re-parenting with an UNCHANGED key set still returns a fresh chain", async () => {
    // The key set must stay identical, or the cheap length/key comparison
    // rebuilds the map and the value-identity check is never exercised — which
    // is exactly how the first version of this test passed against a broken
    // cache.
    const ref = { current: { ...STATE } };
    const socket = makeSocket();
    bindSocketToStore(socket, () => {}, ref);
    const send = (o) => socket._trigger("occurrence_updated", { occurrence: o });

    send({ id: "par",  moduleId: "m-slot", fields: {}, occurrences: ["kid"] });
    send({ id: "par2", moduleId: "m-page", fields: {}, occurrences: [] });
    send({ id: "kid",  moduleId: "m-row",  fields: {}, occurrences: [] });
    await new Promise((r) => setTimeout(r, 60));
    const first = operationsBridge.getAncestorChain("kid");
    expect(first.ids).toEqual(expect.arrayContaining(["kid", "par"]));   // control: it walks
    expect(first.labels).toContain("7:30am");                            // …and reads labels
    expect(first.ids).not.toContain("par2");

    // Same three keys, different VALUES — the kid moves from par to par2.
    send({ id: "par",  moduleId: "m-slot", fields: {}, occurrences: [] });
    send({ id: "par2", moduleId: "m-page", fields: {}, occurrences: ["kid"] });
    await new Promise((r) => setTimeout(r, 60));
    const second = operationsBridge.getAncestorChain("kid");
    expect(second.ids).toContain("par2");
    expect(second.ids).not.toContain("par");
  });

  it("picks up a RENAMED module — the label map follows the modules array", () => {
    // The module map is cached on the modules ARRAY identity. Without that
    // check a rename would never reach the chain labels, and the labels are
    // what ancestor-label rules match on.
    const ref = { current: { ...STATE } };
    const socket = makeSocket();
    bindSocketToStore(socket, () => {}, ref);
    socket._trigger("occurrence_updated", { occurrence: { id: "kid", moduleId: "m-row", fields: {}, occurrences: [] } });
    expect(operationsBridge.getAncestorChain("kid").labels).toContain("Hygiene");   // control

    // A NEW modules array with the row renamed — a reducer swap.
    ref.current = { ...ref.current, modules: STATE.modules.map(m => m.id === "m-row" ? { ...m, label: "Renamed" } : m) };
    const after = operationsBridge.getAncestorChain("kid").labels;
    expect(after).toContain("Renamed");
    expect(after).not.toContain("Hygiene");
  });
});
