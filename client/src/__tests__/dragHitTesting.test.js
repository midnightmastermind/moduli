// __tests__/dragHitTesting.test.js
import { describe, it, expect } from "vitest";
import {
  DROP_TARGET_KIND,
  resolveEdgeToIndex,
  resolveDragMode,
  buildParentMap,
  walkHoveredOccurrence,
  buildDropContext,
} from "../helpers/dragHitTesting";

describe("DROP_TARGET_KIND", () => {
  it("exports the three kinds", () => {
    expect(DROP_TARGET_KIND.OCCURRENCE).toBe("occurrence");
    expect(DROP_TARGET_KIND.GRID_CELL).toBe("grid-cell");
    expect(DROP_TARGET_KIND.DOC_CURSOR).toBe("doc-cursor");
  });
});

describe("resolveEdgeToIndex", () => {
  it("edge=top returns hoveredIndex (different container)", () => {
    expect(resolveEdgeToIndex("top", 2, -1)).toBe(2);
  });
  it("edge=bottom returns hoveredIndex+1 (different container)", () => {
    expect(resolveEdgeToIndex("bottom", 2, -1)).toBe(3);
  });
  it("edge=left returns hoveredIndex", () => {
    expect(resolveEdgeToIndex("left", 2, -1)).toBe(2);
  });
  it("edge=right returns hoveredIndex+1", () => {
    expect(resolveEdgeToIndex("right", 2, -1)).toBe(3);
  });
  it("null edge defaults to hoveredIndex", () => {
    expect(resolveEdgeToIndex(null, 2, -1)).toBe(2);
  });
  it("same-container forward move shifts by -1 (drop on bottom)", () => {
    // Dragging from idx 0 over idx 2, edge=bottom → naive 3, adjusted 2.
    expect(resolveEdgeToIndex("bottom", 2, 0)).toBe(2);
  });
  it("same-container forward move shifts by -1 (drop on top)", () => {
    // Dragging from idx 0 over idx 2, edge=top → naive 2, adjusted 1.
    expect(resolveEdgeToIndex("top", 2, 0)).toBe(1);
  });
  it("same-container backward move stays put (no shift)", () => {
    // Dragging from idx 5 over idx 2, edge=top → 2 (no shift since fromIndex > hoveredIndex).
    expect(resolveEdgeToIndex("top", 2, 5)).toBe(2);
  });
  it("clamps to 0 when adjustment underflows", () => {
    expect(resolveEdgeToIndex("top", 0, -1)).toBe(0);
  });
});

describe("resolveDragMode", () => {
  it("default returns the payload default", () => {
    expect(resolveDragMode({}, "move")).toBe("move");
    expect(resolveDragMode({}, "copy")).toBe("copy");
  });
  it("alt forces copy", () => {
    expect(resolveDragMode({ alt: true }, "move")).toBe("copy");
  });
  it("alt+shift forces copylink", () => {
    expect(resolveDragMode({ alt: true, shift: true }, "move")).toBe("copylink");
  });
  it("shift alone keeps default", () => {
    expect(resolveDragMode({ shift: true }, "move")).toBe("move");
  });
  it("falsy default falls back to move", () => {
    expect(resolveDragMode({}, null)).toBe("move");
  });
});

describe("buildParentMap", () => {
  it("indexes parent by child via .occurrences[]", () => {
    const occs = {
      p1: { id: "p1", occurrences: ["c1", "c2"] },
      c1: { id: "c1", occurrences: ["i1"] },
      c2: { id: "c2", occurrences: [] },
      i1: { id: "i1", occurrences: [] },
    };
    expect(buildParentMap(occs)).toEqual({ c1: "p1", c2: "p1", i1: "c1" });
  });
  it("returns empty object for empty input", () => {
    expect(buildParentMap({})).toEqual({});
  });
  it("ignores occurrences without .occurrences[] arrays", () => {
    const occs = { a: { id: "a" }, b: { id: "b", occurrences: ["a"] } };
    expect(buildParentMap(occs)).toEqual({ a: "b" });
  });
});

function makeEl(attrs = {}) {
  return { getAttribute: (k) => attrs[k] ?? null };
}

describe("walkHoveredOccurrence", () => {
  it("returns null when no occurrence is hit", () => {
    const elementsFromPoint = () => [makeEl({})];
    expect(walkHoveredOccurrence(0, 0, { elementsFromPoint })).toBeNull();
  });
  it("returns the innermost data-occurrence-id", () => {
    const elementsFromPoint = () => [
      makeEl({ "data-occurrence-id": "inner" }),
      makeEl({ "data-occurrence-id": "outer" }),
    ];
    expect(walkHoveredOccurrence(0, 0, { elementsFromPoint }))
      .toEqual({ occurrenceId: "inner" });
  });
  it("falls back to data-occ-id and data-instance-id", () => {
    const elementsFromPoint = () => [makeEl({ "data-occ-id": "x" })];
    expect(walkHoveredOccurrence(0, 0, { elementsFromPoint }))
      .toEqual({ occurrenceId: "x" });
  });
  it("ignores elements without occurrence attributes", () => {
    const elementsFromPoint = () => [makeEl({}), makeEl({ "data-occurrence-id": "y" })];
    expect(walkHoveredOccurrence(0, 0, { elementsFromPoint }))
      .toEqual({ occurrenceId: "y" });
  });
  it("does not throw when neither env.elementsFromPoint nor document.elementsFromPoint exists", () => {
    // jsdom in the test runner may not implement elementsFromPoint.
    expect(() => walkHoveredOccurrence(0, 0, {})).not.toThrow();
  });
});

const FIXTURE = {
  occs: {
    container: { id: "container", moduleId: "mC", targetId: "mC", occurrences: ["b", "x", "a"] },
    a: { id: "a", moduleId: "mI", targetId: "mI", occurrences: [] },
    b: { id: "b", moduleId: "mI", targetId: "mI", occurrences: [] },
    x: { id: "x", moduleId: "mI", targetId: "mI", occurrences: [] },
  },
  modules: {
    mC: { id: "mC", role: "container" },
    mI: { id: "mI", role: "instance" },
  },
};

const ENV = () => ({
  occurrencesById: FIXTURE.occs,
  modulesById: FIXTURE.modules,
});

describe("buildDropContext", () => {
  it("returns null when there is no target", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "in-grid" },
      hover: { x: 0, y: 0, dropTargetData: null },
      modifiers: {},
    };
    expect(buildDropContext(raw, ENV())).toBeNull();
  });

  it("instance-over-instance same container fills insertIndex", () => {
    // Source a is at idx 2; hovered x is at idx 1; edge=top → naive 1,
    // fromIndex (2) > hoveredIndex (1), so no shift → 1.
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "in-grid" },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "x", closestEdge: "top" } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, ENV());
    expect(ctx.target.kind).toBe(DROP_TARGET_KIND.OCCURRENCE);
    expect(ctx.target.occurrenceId).toBe("x");
    expect(ctx.target.parentOccurrenceId).toBe("container");
    expect(ctx.target.moduleId).toBe("mI");
    expect(ctx.position.edge).toBe("top");
    expect(ctx.position.insertIndex).toBe(1);
  });

  it("dragging from idx 0 over idx 2 with edge=bottom resolves to 2", () => {
    // b at idx 0, a at idx 2, edge=bottom → naive 3 → adjusted 2.
    const raw = {
      source: { occurrenceId: "b", moduleId: "mI", sourceKind: "in-grid" },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "a", closestEdge: "bottom" } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, ENV());
    expect(ctx.position.insertIndex).toBe(2);
  });

  it("falls back to append-to-end when hover is on container with no edge", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "command-center" },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "container" } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, ENV());
    expect(ctx.target.occurrenceId).toBe("container");
    expect(ctx.target.kind).toBe(DROP_TARGET_KIND.OCCURRENCE);
    expect(ctx.position.insertIndex).toBe(3);
  });

  it("propagates grid-cell kind", () => {
    const raw = {
      source: { occurrenceId: null, moduleId: "mC", sourceKind: "command-center" },
      hover: { x: 0, y: 0, dropTargetData: { kind: "grid-cell", gridCell: { row: 1, col: 2 } } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, ENV());
    expect(ctx.target.kind).toBe(DROP_TARGET_KIND.GRID_CELL);
    expect(ctx.target.gridCell).toEqual({ row: 1, col: 2 });
    expect(ctx.target.occurrenceId).toBeNull();
  });

  it("propagates doc-cursor kind", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "in-grid" },
      hover: { x: 0, y: 0, dropTargetData: { kind: "doc-cursor", editorPos: 42, occurrenceId: "container" } },
      modifiers: {},
    };
    const ctx = buildDropContext(raw, ENV());
    expect(ctx.target.kind).toBe(DROP_TARGET_KIND.DOC_CURSOR);
    expect(ctx.target.docCursor).toEqual({ editorPos: 42, occurrenceId: "container" });
  });

  it("derives mode from modifiers", () => {
    const raw = {
      source: { occurrenceId: "a", moduleId: "mI", sourceKind: "in-grid", defaultMode: "move" },
      hover: { x: 0, y: 0, dropTargetData: { occurrenceId: "x", closestEdge: "top" } },
      modifiers: { alt: true },
    };
    const ctx = buildDropContext(raw, ENV());
    expect(ctx.mode).toBe("copy");
  });
});

import { collectMemberCards } from "../helpers/dragHitTesting.js";

describe("collectMemberCards", () => {
  it("returns direct leaf rows and nested container shells, not grandchildren", () => {
    document.body.innerHTML = `
      <div id="outer" data-container-id="outer">
        <div class="instance-wrap" id="leaf1"></div>
        <div>
          <div data-container-id="nested" id="nestedShell">
            <div class="instance-wrap" id="grandchildLeaf"></div>
          </div>
        </div>
      </div>`;
    const outer = document.getElementById("outer");
    const ids = collectMemberCards(outer).map((el) => el.id);
    expect(ids).toContain("leaf1");
    expect(ids).toContain("nestedShell");
    expect(ids).not.toContain("grandchildLeaf"); // owned by the nested shell
    expect(ids).not.toContain("outer");
  });
  it("returns [] for a null container", () => {
    expect(collectMemberCards(null)).toEqual([]);
  });
});
