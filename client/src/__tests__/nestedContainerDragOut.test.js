// A CONTAINER NESTED IN A CONTAINER CAN BE DRAGGED OUT.
//
// USER, 2026-09-23: *"i cant drag new containers outside of containers in
// routine. i created a new container inside the creative container on poms, and
// i cant drag it outside of that."*
//
// Reproduced on the live grid: "Mr Brews Taphouse" is a `container/board` with
// no children, listed by `Creative`, which is itself one of nine dimension
// containers on the Routines page — each carrying `allowChildContainers: true`.
//
// `handleContainerDrop`'s default branch resolved the SOURCE list as the PAGE:
//
//     const fromOrderOcc = fromPageOccId ? occurrencesById[fromPageOccId] : ...
//     const occurrenceId = findOccurrenceIdByTarget(draggedId, fromOrderOcc.occurrences, ...)
//     if (!occurrenceId) { clearSession(); return; }        // <- silent no-op
//
// A nested container is listed by its PARENT CONTAINER, not by the page, so the
// lookup missed and the handler returned having done nothing at all — no error,
// no toast, the card just stayed put.
//
// The drag payload already carries the dragged occurrence's own id, so the
// source list is a reverse-map lookup rather than a guess: placement IS the
// parent's child list, the rule the rest of the grid follows.
import { describe, it, expect, vi, beforeEach } from "vitest";

const updates = [];
const moves = [];
vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: (a) => { updates.push(a.occurrence); },
  createOccurrence: vi.fn(), createModule: vi.fn(), removeOccurrence: vi.fn(), updateModule: vi.fn(),
}));
vi.mock("../helpers/LayoutHelpers", () => ({
  moveContainerBetweenPanels: (a) => { moves.push({ kind: "move", ...a }); },
  reorderContainersInPanel: (a) => { moves.push({ kind: "reorder", ...a }); },
  copyContainerToPanel: (a) => { moves.push({ kind: "copy", ...a }); },
  createContainerInPanel: vi.fn(),
  findOccurrenceIdByTarget: (moduleId, ids, occs) =>
    (ids || []).find(id => occs[id]?.moduleId === moduleId) || null,
  getTargetIndexInOccurrences: (moduleId, ids, occs) =>
    (ids || []).findIndex(id => occs[id]?.moduleId === moduleId),
}));

const { handleContainerDrop } = await import("../helpers/dropHandlers");

// Routines page → Creative → Mr Brews Taphouse
const PAGE = { id: "page", moduleId: "m-page", occurrences: ["creative", "environmental"] };
const CREATIVE = { id: "creative", moduleId: "m-creative", occurrences: ["brews"] };
const ENV = { id: "environmental", moduleId: "m-env", occurrences: [] };
const BREWS = { id: "brews", moduleId: "m-brews", occurrences: [] };

const occurrencesById = { page: PAGE, creative: CREATIVE, environmental: ENV, brews: BREWS };
const modulesById = {
  "m-page":      { id: "m-page",      role: "page",      kind: "board", label: "Routines" },
  "m-creative":  { id: "m-creative",  role: "container", kind: "board", label: "Creative" },
  "m-env":       { id: "m-env",       role: "container", kind: "board", label: "Environmental" },
  "m-brews":     { id: "m-brews",     role: "container", kind: "board", label: "Mr Brews Taphouse" },
};

function ctx() {
  return {
    dispatch: vi.fn(), socket: {},
    state: { modulesById, gridId: "g1", userId: "u1", grid: {} },
    occurrencesById,
    baseAllPanels: [{ id: "panelA", _occurrence: { id: "panelOcc" } }],
    baseContainers: [],
    clearSession: vi.fn(),
    sessionRef: { current: { mode: "move" } },
  };
}

// Drop it onto the PAGE, outside Creative. `dropView` builds the drop target
// from `target` + `target.raw` (what the drop zone registered), so the fixture
// has to speak that shape rather than a hand-made dropTarget.
function dropOntoPage(insertIndex) {
  return {
    payload: {
      moduleId: "m-brews",
      context: { panelId: "panelA", occurrenceId: "brews", pageOccurrenceId: "page" },
    },
    target: { kind: "page-content", moduleId: "m-page", occurrenceId: "page",
              raw: { pageOccurrenceId: "page", panelId: "panelA" } },
    position: { edge: null, insertIndex },
    pointer: { x: 10, y: 10 }, mode: "move", modifiers: {},
  };
}

beforeEach(() => { updates.length = 0; moves.length = 0; });

describe("dragging a nested container out to the page", () => {
  it("MOVES it instead of silently doing nothing", () => {
    handleContainerDrop(dropOntoPage(), ctx());
    expect(moves.length).toBeGreaterThan(0);
    const mv = moves.find(m => m.kind === "move");
    expect(mv).toBeTruthy();
    expect(mv.occurrenceId).toBe("brews");
  });

  it("takes it out of CREATIVE, not out of the page", () => {
    // The whole defect: the source list was read as the page's children, where
    // the dragged container does not appear.
    handleContainerDrop(dropOntoPage(), ctx());
    const mv = moves.find(m => m.kind === "move");
    expect(mv.fromPanelOccurrence.id).toBe("creative");
    expect(mv.toPanelOccurrence.id).toBe("page");
  });
});

describe("the ordinary case still works (controls)", () => {
  it("a container already on the page reorders within it", () => {
    const c = ctx();
    const drop = {
      payload: { moduleId: "m-env", context: { panelId: "panelA", occurrenceId: "environmental", pageOccurrenceId: "page" } },
      target: { kind: "page-content", moduleId: "m-page", occurrenceId: "page",
                raw: { pageOccurrenceId: "page", panelId: "panelA" } },
      position: { edge: null, insertIndex: 0 },
      pointer: { x: 10, y: 10 }, mode: "move", modifiers: {},
    };
    handleContainerDrop(drop, c);
    // same list on both sides → a reorder, not a cross-parent move
    const r = moves.find(m => m.kind === "reorder");
    expect(r).toBeTruthy();
    expect(r.panelOccurrence.id).toBe("page");
  });

  it("a drag with no resolvable occurrence still bails cleanly", () => {
    const c = ctx();
    const drop = {
      payload: { moduleId: "m-nothing", context: { panelId: "panelA", pageOccurrenceId: "page" } },
      target: { kind: "page-content", moduleId: "m-page", occurrenceId: "page",
                raw: { pageOccurrenceId: "page", panelId: "panelA" } },
      position: { edge: null, insertIndex: undefined },
      pointer: { x: 10, y: 10 }, mode: "move", modifiers: {},
    };
    handleContainerDrop(drop, c);
    expect(moves).toEqual([]);
    expect(c.clearSession).toHaveBeenCalled();
  });
});
