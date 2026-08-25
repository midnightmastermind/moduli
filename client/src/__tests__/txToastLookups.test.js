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
import { byIdCached, bindSocketToStore } from "../state/bindSocketToStore";

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

  test("a SnapshotOp is still ignored outright — it is an undo record, not an event", () => {
    const socket = bind();
    if (!socket._has("transaction_created")) return;
    pushed.length = 0;
    socket._trigger("transaction_created", { transaction: { id: "t3", type: "SnapshotOp", operations: [] } });
    expect(pushed).toEqual([]);
  });
});
