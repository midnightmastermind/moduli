// @vitest-environment jsdom
// A Copy / Copy-link drag dropped in the SAME container makes a copy there
// (user, 2026-10-27: "the app also isnt letting me copy into the same
// container"). It used to reorder the original instead. A Move still reorders.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = { copy: [], link: [], reorder: [] };
vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: vi.fn(), createOccurrence: vi.fn(), createModule: vi.fn(), removeOccurrence: vi.fn(), updateModule: vi.fn(),
}));
vi.mock("../helpers/LayoutHelpers", () => ({
  copyInstanceToContainer: (a) => { calls.copy.push(a); return { occurrence: { id: "new" } }; },
  copylinkInstanceToContainer: (a) => { calls.link.push(a); },
  reorderInstancesInContainer: (a) => { calls.reorder.push(a); },
  moveInstanceBetweenContainers: vi.fn(),
  findOccurrenceIdByTarget: (moduleId, ids, occs) => (ids || []).find((id) => occs[id]?.moduleId === moduleId) || null,
  getTargetIndexInOccurrences: (moduleId, ids, occs) => (ids || []).findIndex((id) => occs[id]?.moduleId === moduleId),
}));

const { operationsBridge } = await import("../state/bindSocketToStore");
const { handleOccurrenceMove } = await import("../helpers/dropHandlers");

const BOX = { id: "box", moduleId: "m-box", occurrences: ["a", "b", "c"] };
const occurrencesById = {
  box: BOX,
  a: { id: "a", moduleId: "m-a", parentId: "box", fields: {} },
  b: { id: "b", moduleId: "m-b", parentId: "box", fields: {} },
  c: { id: "c", moduleId: "m-c", parentId: "box", fields: {} },
};
const modulesById = {
  "m-box": { id: "m-box", role: "container", kind: "board", label: "Appointments" },
  "m-a": { id: "m-a", role: "instance", label: "Keith" },
  "m-b": { id: "m-b", role: "instance", label: "B" },
  "m-c": { id: "m-c", role: "instance", label: "C" },
};
const ctx = (mode) => ({
  dispatch: vi.fn(), socket: {},
  state: { modulesById, gridId: "g1", userId: "u1", grid: { occurrences: [] }, modules: Object.values(modulesById) },
  occurrencesById, baseContainers: [modulesById["m-box"]], baseAllPanels: [],
  clearSession: vi.fn(), sessionRef: { current: { mode } },
});
// drag "a" onto the bottom edge of "c"
const drop = (mode) => ({
  payload: { moduleId: "m-a", occurrenceId: "a", context: { containerId: "m-box", containerOccurrenceId: "box" } },
  target: { kind: "instance", moduleId: "m-c", occurrenceId: "c", parentOccurrenceId: "box", raw: { containerId: "m-box", containerOccurrenceId: "box", closestEdge: "bottom" } },
  position: { edge: "bottom", insertIndex: null }, pointer: { x: 1, y: 1 }, mode, modifiers: {},
});

beforeEach(() => {
  calls.copy.length = 0; calls.link.length = 0; calls.reorder.length = 0;
  operationsBridge.fireOperations = () => {};
  operationsBridge.getAncestorChain = () => ({ ids: [], labels: [] });
  operationsBridge.updateLocalOcc = () => {};
});

describe("dropping in the same container", () => {
  it("Copy mode makes a copy, at the drop point (the original stays)", () => {
    handleOccurrenceMove(drop("copy"), ctx("copy"));
    expect(calls.reorder).toHaveLength(0);
    expect(calls.copy).toHaveLength(1);
    expect(calls.copy[0].toContainer._occurrence.id).toBe("box");
    expect(calls.copy[0].toIndex).toBe(3);   // after "c"; not shifted, the original is not removed
  });
  it("dropped on its OWN row's bottom edge, the copy lands right after it", () => {
    const onSelf = drop("copy");
    onSelf.target = { ...onSelf.target, moduleId: "m-a", occurrenceId: "a" };
    handleOccurrenceMove(onSelf, ctx("copy"));
    expect(calls.copy).toHaveLength(1);
    expect(calls.copy[0].toIndex).toBe(1);
  });
  it("Copy-link mode makes a linked copy", () => {
    handleOccurrenceMove(drop("copylink"), ctx("copylink"));
    expect(calls.reorder).toHaveLength(0);
    expect(calls.link).toHaveLength(1);
  });
  it("Move mode still reorders", () => {
    handleOccurrenceMove(drop("move"), ctx("move"));
    expect(calls.copy).toHaveLength(0);
    expect(calls.reorder).toHaveLength(1);
    expect(calls.reorder[0]).toMatchObject({ fromIndex: 0, toIndex: 2 });
  });
});
