// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: vi.fn(), createOccurrence: vi.fn() }));
vi.mock("../state/notificationStore", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }));

import * as CommitHelpers from "../helpers/CommitHelpers";
import { planGroupMove, groupForDrag, groupDestination, groupInsertAt, setSelectionSnapshot } from "../helpers/selectionDrag";
import { routeDrop } from "../helpers/dropHandlers";

const modulesById = {
  boardM: { id: "boardM", role: "container", kind: "board", label: "Board" },
  docM: { id: "docM", role: "container", kind: "doc" },
  pageM: { id: "pageM", role: "page", kind: "board" },
  canvasM: { id: "canvasM", role: "page", kind: "canvas" },
  rowM: { id: "rowM", role: "instance", label: "Row" },
};
function world() {
  return {
    A: { id: "A", moduleId: "boardM", occurrences: ["a1", "a2", "a3"] },
    B: { id: "B", moduleId: "boardM", occurrences: ["b1", "b2"] },
    D: { id: "D", moduleId: "docM", occurrences: [] },
    a1: { id: "a1", moduleId: "rowM", parentId: "A" },
    a2: { id: "a2", moduleId: "rowM", parentId: "A" },
    a3: { id: "a3", moduleId: "rowM", parentId: "A" },
    b1: { id: "b1", moduleId: "rowM", parentId: "B" },
    b2: { id: "b2", moduleId: "rowM", parentId: "B" },
  };
}

describe("planGroupMove", () => {
  it("moves every selected row into the destination at the drop line, in order", () => {
    const { lists, moved } = planGroupMove({ ids: ["a1", "a3"], destId: "B", insertAt: 1, occurrencesById: world() });
    expect(lists.B).toEqual(["b1", "a1", "a3", "b2"]);
    expect(lists.A).toEqual(["a2"]);
    expect(moved).toEqual([{ id: "a1", fromId: "A" }, { id: "a3", fromId: "A" }]);
  });

  it("rows from two containers each leave their own list", () => {
    const { lists } = planGroupMove({ ids: ["a2", "b2"], destId: "B", insertAt: 0, occurrencesById: world() });
    expect(lists.B).toEqual(["a2", "b2", "b1"]);
    expect(lists.A).toEqual(["a1", "a3"]);
  });

  it("a reorder inside one list counts the line in the list the user sees", () => {
    // Line drawn after a3 (index 3) while dragging a1 + a2 → they go to the end.
    const { lists } = planGroupMove({ ids: ["a1", "a2"], destId: "A", insertAt: 3, occurrencesById: world() });
    expect(lists.A).toEqual(["a3", "a1", "a2"]);
  });

  it("no line appends", () => {
    expect(planGroupMove({ ids: ["a1", "b1"], destId: "B", occurrencesById: world() }).lists.B).toEqual(["b2", "a1", "b1"]);
  });
});

describe("gates", () => {
  it("a drag is a group only when the dragged row is selected with another row", () => {
    const occ = world();
    expect(groupForDrag("a1", new Set(["a1"]), { occurrencesById: occ, modulesById })).toBe(null);
    expect(groupForDrag("a1", new Set(["a2", "a3"]), { occurrencesById: occ, modulesById })).toBe(null);
    expect(groupForDrag("a1", new Set(["a1", "a2", "B"]), { occurrencesById: occ, modulesById })).toEqual(["a1", "a2"]);
  });

  it("a doc container and a canvas page are not group destinations", () => {
    const occ = { ...world(), P: { id: "P", moduleId: "canvasM" } };
    expect(groupDestination({ dropTarget: { context: {} }, containerOccurrenceId: "D", occurrencesById: occ, modulesById })).toBe(null);
    expect(groupDestination({ dropTarget: { context: { pageOccurrenceId: "P" } }, containerOccurrenceId: null, occurrencesById: occ, modulesById })).toBe(null);
    expect(groupDestination({ dropTarget: { context: {} }, containerOccurrenceId: "B", occurrencesById: occ, modulesById })?.id).toBe("B");
  });

  it("without a line, lands beside the hovered row by its edge", () => {
    const dest = world().B;
    expect(groupInsertAt({ dropTarget: { context: { closestEdge: "bottom" } }, hoveredOccId: "b1", dest })).toBe(1);
    expect(groupInsertAt({ dropTarget: { context: { closestEdge: "top" } }, hoveredOccId: "b1", dest })).toBe(0);
    expect(groupInsertAt({ dropTarget: { context: { insertAt: 2 } }, hoveredOccId: "b1", dest })).toBe(2);
  });
});

describe("routeDrop carries the selection", () => {
  beforeEach(() => { CommitHelpers.updateOccurrence.mockClear(); });
  const ctx = (occ) => ({
    dispatch: vi.fn(), socket: null, occurrencesById: occ, state: { modulesById, grid: null },
    sessionRef: { current: { mode: "move" } }, baseContainers: Object.values(modulesById), clearSession: vi.fn(),
  });
  const drop = { payload: { moduleId: "rowM", sourceKind: "in-grid", context: { occurrenceId: "a1", containerId: "boardM", containerOccurrenceId: "A" } },
    target: { kind: "container-list", occurrenceId: "B", moduleId: "boardM" }, position: { insertIndex: 2 }, pointer: { x: 0, y: 0 }, mode: "move" };

  it("dragging one selected row moves every selected row", () => {
    setSelectionSnapshot(new Set(["a1", "a3"]));
    routeDrop(drop, ctx(world()));
    const lists = Object.fromEntries(CommitHelpers.updateOccurrence.mock.calls
      .map(([a]) => a.occurrence).filter((o) => o.occurrences).map((o) => [o.id, o.occurrences]));
    expect(lists.B).toEqual(["b1", "b2", "a1", "a3"]);
    expect(lists.A).toEqual(["a2"]);
  });

  it("a row dragged with nothing else selected is the ordinary single drop", () => {
    setSelectionSnapshot(new Set());
    routeDrop(drop, ctx(world()));
    const lists = CommitHelpers.updateOccurrence.mock.calls.map(([a]) => a.occurrence).filter((o) => o.occurrences);
    expect(lists.some((o) => o.id === "B" && o.occurrences.includes("a3"))).toBe(false);
  });
});
