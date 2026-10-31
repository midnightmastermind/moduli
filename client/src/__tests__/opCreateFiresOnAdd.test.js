// @vitest-environment jsdom
// A row an OPERATION creates inside a user's gesture (a button press, a form) fires the onAdd/onCreate
// triggers — user, 2026-10-31: "the operations should work for all onAdd buttons as well". A row the app makes
// for itself (load sweep, schedule: DERIVED or no action open) does not, and rows made by the ops that fire
// runs do not fire again (one level), so an onAdd op that creates cannot loop.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls = [];
let onFire = null;
vi.mock("../helpers/operationExecutor", async (orig) => {
  const real = await orig();
  return {
    ...real,
    runMatchingOperations: (ops, type, tx) => {
      calls.push({ type, tx });
      if (onFire) onFire(type, tx);
      return [];
    },
  };
});

const store = {};
vi.stubGlobal("localStorage", {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
});

import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";
import { withAction, runDerived } from "../helpers/actionScope";

function bind() {
  const socket = { connected: true, on() {}, emit() {} };
  bindSocketToStore(socket, () => {}, {
    current: {
      gridId: "g1", userId: "u1",
      modules: [], occurrences: [{ id: "parent-1", occurrences: [] }],
      operations: [{ id: "op1", name: "x", enabled: true, triggerObjects: [{ eventType: "onAdd" }] }],
      fields: [], modulesById: {}, occurrencesById: {},
    },
  });
}
const create = (id) => operationsBridge.applyEffect({
  _effect: "CREATE_ITEM",
  template: { id: `m-${id}`, role: "instance", label: id },
  instance: { id, templateId: `m-${id}`, parentId: "parent-1" },
});
const creates = () => calls.filter((c) => c.type === "OccurrenceCreateOp");

describe("an op-created row fires OccurrenceCreateOp inside a user action", () => {
  beforeEach(() => { calls.length = 0; onFire = null; vi.useFakeTimers(); bind(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a create inside a gesture fires once, for that row", () => {
    withAction("Pressed New task", () => create("task-1"));
    expect(creates()).toHaveLength(0); // deferred until the creating op has applied
    vi.advanceTimersByTime(10);
    expect(creates()).toHaveLength(1);
    expect(creates()[0].tx.occurrenceId).toBe("task-1");
    expect(creates()[0].tx.containerId).toBe("parent-1");
  });

  it("a DERIVED create (the load sweep) fires nothing", () => {
    runDerived(() => create("sweep-1"));
    vi.advanceTimersByTime(10);
    expect(creates()).toHaveLength(0);
  });

  it("a create with no action open fires nothing", () => {
    create("bare-1");
    vi.advanceTimersByTime(10);
    expect(creates()).toHaveLength(0);
  });

  it("a row created by an op the fire ran does not fire again (one level)", () => {
    onFire = (type, tx) => { if (type === "OccurrenceCreateOp" && tx.occurrenceId === "task-1") create("nested-1"); };
    withAction("Pressed New task", () => create("task-1"));
    vi.advanceTimersByTime(10);
    expect(creates().map((c) => c.tx.occurrenceId)).toEqual(["task-1"]);
  });

  it("a feed copy fires nothing", () => {
    withAction("x", () => operationsBridge.applyEffect({
      _effect: "CREATE_ITEM",
      template: { id: "m-f", role: "instance", label: "f" },
      instance: { id: "feed-1", templateId: "m-f", parentId: "parent-1", meta: { feedSourceId: "src" } },
    }));
    vi.advanceTimersByTime(10);
    expect(creates()).toHaveLength(0);
  });
});
