// A CONTAINER DROPPED ON THE EDGE OF A NESTED CONTAINER LANDS BESIDE IT.
//
// 2026-10-08, rebuilding poms' Trackers by clicking: poms nests Nutrition and
// Media inside Physical, and dragging the rebuild's top-level Nutrition onto the
// edge of Physical › Workout did NOTHING. `handleContainerDrop` read the
// destination list as the PAGE, where Workout is not listed, so the hovered
// index was -1, `toIndex` stayed null and the handler returned silently.
//
// The source side learned "whoever lists it" on 2026-09-23 (nestedContainerDragOut);
// the destination is the same rule: the list a drop lands in is the list that
// holds the container under the pointer.
import { describe, it, expect } from "vitest";
import { containerDropDestination } from "../helpers/containerDropDestination";

const occs = {
  page: { id: "page", occurrences: ["physical", "nutrition"] },
  physical: { id: "physical", occurrences: ["coffee", "workout"] },
  workout: { id: "workout", occurrences: ["log"] },
  nutrition: { id: "nutrition", occurrences: ["meal"] },
  inner: { id: "inner", occurrences: [] },
};

describe("containerDropDestination", () => {
  it("a nested hovered container -> its PARENT container's list, at its index", () => {
    const d = containerDropDestination({ hoveredOccId: "workout", draggedOccId: "nutrition", occurrencesById: occs, fallback: occs.page });
    expect(d.list.id).toBe("physical");
    expect(d.hoveredIndex).toBe(1);
  });

  it("a top-level hovered container -> the page, as before (control)", () => {
    const d = containerDropDestination({ hoveredOccId: "physical", draggedOccId: "nutrition", occurrencesById: occs, fallback: occs.page });
    expect(d.list.id).toBe("page");
    expect(d.hoveredIndex).toBe(0);
  });

  it("no hovered container -> the fallback list, no index", () => {
    const d = containerDropDestination({ hoveredOccId: null, draggedOccId: "nutrition", occurrencesById: occs, fallback: occs.page });
    expect(d.list.id).toBe("page");
    expect(d.hoveredIndex).toBe(-1);
  });

  it("refuses a drop into the dragged container's own subtree", () => {
    const o = { ...occs, nutrition: { id: "nutrition", occurrences: ["inner"] } };
    const d = containerDropDestination({ hoveredOccId: "inner", draggedOccId: "nutrition", occurrencesById: o, fallback: o.page });
    expect(d.refused).toBe(true);
  });

  it("a container listed by several parents resolves to the page it is on, else its own parent", () => {
    const o = {
      page: { id: "page", occurrences: ["shared"] },
      colA: { id: "colA", occurrences: ["shared"] },
      colB: { id: "colB", occurrences: ["shared", "other"] },
      shared: { id: "shared", parentId: "colB", occurrences: [] },
      other: { id: "other", occurrences: [] },
    };
    expect(containerDropDestination({ hoveredOccId: "shared", draggedOccId: "other", occurrencesById: o, fallback: o.page }).list.id).toBe("page");
    const noPage = { ...o, page: { id: "page", occurrences: [] } };
    expect(containerDropDestination({ hoveredOccId: "shared", draggedOccId: "x", occurrencesById: noPage, fallback: noPage.page }).list.id).toBe("colB");
  });

  it("hovering the dragged container itself keeps its own list (a no-op reorder, not a refusal)", () => {
    const d = containerDropDestination({ hoveredOccId: "nutrition", draggedOccId: "nutrition", occurrencesById: occs, fallback: occs.page });
    expect(d.refused).toBeFalsy();
    expect(d.list.id).toBe("page");
  });
});
