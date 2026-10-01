// @vitest-environment jsdom
// A MOVE between containers: the instance's own parentId follows it, the executor
// sees the POST-move tree, and the move trigger carries the ancestor chain.
//
// Measured on the rebuild 2026-09-29: after dragging an instance from 3:00pm to
// 3:30pm it was LISTED by 3:30pm while its parentId still named 3:00pm, and no
// `onMove · in Schedule` trigger fired — the branch hand-rolled its own
// OccurrenceMoveOp with no _ancestorIds, so every ancestor-scoped trigger failed
// closed. And moving between two DAYS' copies of one slot (same module) was
// treated as "same container" and reordered in place.
import { describe, it, expect, vi, beforeEach } from "vitest";

const updates = [];
vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: (a) => { updates.push(a.occurrence); },
  createOccurrence: vi.fn(), createModule: vi.fn(), removeOccurrence: vi.fn(), updateModule: vi.fn(),
}));
const moves = [];
vi.mock("../helpers/LayoutHelpers", () => ({
  moveInstanceBetweenContainers: (a) => moves.push([a.fromContainerOccurrence.id, a.toContainerOccurrence.id]),
  reorderInstancesInContainer: vi.fn(),
  findOccurrenceIdByTarget: (moduleId, ids, occs) => (ids || []).find((id) => occs[id]?.moduleId === moduleId) || null,
  getTargetIndexInOccurrences: (moduleId, ids, occs) => (ids || []).findIndex((id) => occs[id]?.moduleId === moduleId),
}));

const { operationsBridge } = await import("../state/bindSocketToStore");
const { handleOccurrenceMove } = await import("../helpers/dropHandlers");

// Two days' copies of ONE slot module + a different slot module.
const SEP28_300 = { id: "s28-300", moduleId: "m-300", occurrences: ["inst"] };
const SEP29_300 = { id: "s29-300", moduleId: "m-300", occurrences: [] };
const SEP28_330 = { id: "s28-330", moduleId: "m-330", occurrences: [] };
const INST = { id: "inst", moduleId: "m-inst", parentId: "s28-300", fields: {} };
const occurrencesById = { "s28-300": SEP28_300, "s29-300": SEP29_300, "s28-330": SEP28_330, inst: INST };
const modulesById = {
  "m-300": { id: "m-300", role: "container", kind: "board", label: "3:00pm" },
  "m-330": { id: "m-330", role: "container", kind: "board", label: "3:30pm" },
  "m-inst": { id: "m-inst", role: "instance", label: "Call" },
};
const ctx = () => ({
  dispatch: vi.fn(), socket: {},
  state: { modulesById, gridId: "g1", userId: "u1", grid: { occurrences: [] }, modules: Object.values(modulesById) },
  occurrencesById, baseContainers: [modulesById["m-300"], modulesById["m-330"]], baseAllPanels: [],
  clearSession: vi.fn(), sessionRef: { current: { mode: "move" } },
});
const drop = (toOcc) => ({
  payload: { moduleId: "m-inst", occurrenceId: "inst", context: { containerId: "m-300", containerOccurrenceId: "s28-300" } },
  target: { kind: "container", moduleId: toOcc.moduleId, occurrenceId: toOcc.id, raw: {} },
  position: { edge: null, insertIndex: null }, pointer: { x: 1, y: 1 }, mode: "move", modifiers: {},
});

let fired, localWrites;
beforeEach(() => {
  updates.length = 0; moves.length = 0; fired = []; localWrites = [];
  operationsBridge.fireOperations = (type, tx) => fired.push({ type, tx, localAtFire: [...localWrites] });
  operationsBridge.getAncestorChain = (id) => ({ ids: [id, "slot", "col", "schedule-page"], labels: [] });
  operationsBridge.updateLocalOcc = (o) => localWrites.push(o);
});

describe("moving an instance between containers", () => {
  it("writes the instance's own parentId to the destination", () => {
    handleOccurrenceMove(drop(SEP28_330), ctx());
    expect(updates).toContainEqual({ id: "inst", parentId: "s28-330" });
  });

  it("fires ONE move trigger carrying the ancestor chain", () => {
    handleOccurrenceMove(drop(SEP28_330), ctx());
    const mv = fired.filter((f) => f.type === "OccurrenceMoveOp");
    expect(mv).toHaveLength(1);
    expect(mv[0].tx._ancestorIds).toContain("schedule-page");
  });

  it("the executor already sees the post-move parent when the trigger fires", () => {
    handleOccurrenceMove(drop(SEP28_330), ctx());
    const mv = fired.find((f) => f.type === "OccurrenceMoveOp");
    expect(mv.localAtFire.find((o) => o.id === "inst")?.parentId).toBe("s28-330");
  });

  it("a move between two days' copies of ONE slot is a move, not a reorder", () => {
    handleOccurrenceMove(drop(SEP29_300), ctx());
    expect(moves).toEqual([["s28-300", "s29-300"]]);
    expect(updates).toContainEqual({ id: "inst", parentId: "s29-300" });
  });
});
